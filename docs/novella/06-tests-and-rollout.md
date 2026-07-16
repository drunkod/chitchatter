# 06 — Tests, manual validation, and rollout

> **Revision 3 changes:** the test mesh implements the narrow `VisualNovelTransport` interface (the concrete `PeerRoom` has private members and is not structurally substitutable) with **multiple receivers per action, real join/leave handlers, and a `disconnect()` operation** — the previous fake could not run the promised late-join and controller-departure tests at all. New test cases cover the Revision 3 protocol: election handshake, winner-only `CONTROLLER_CHANGED` with supersession, snapshot-class authorization (forged snapshots, unsolicited bootstrap data), simultaneous-start arbitration, engine-replay mismatch recovery, exhaustive dispatch of unimplemented actions, session lifecycle, and send-failure repair.

## Unit-test matrix

### Validator

- Valid complete story and envelope of every action type.
- Missing start scene, empty dialogue, duplicate IDs, nonexistent transitions.
- Unknown asset keys, path traversal, external origins, unsupported extensions.
- Unknown action/effect/operator, unsupported protocol, invalid numbers.
- Oversized envelope, snapshot, history, variables, variable values, text, identifiers.
- **Deep collection checks:** malformed history entries (bad revision/IDs/types) and malformed `CHOICE_RESOLVED` variables (count, key format, value type).
- **Cross-field checks:** envelope↔payload mismatch on sessionId/storyId/storyVersion/revision for every state-carrying action; `SESSION_STARTED` with non-zero revision or controller ≠ sender.
- **Normalization:** mutating input after validation does not affect the returned value; no extra properties survive; cyclic input fails cleanly instead of throwing.
- `toSnapshotState` truncation; maximal truncated state passes; bootstrap-scoped `STATE_REQUEST` is valid.
- Envelope sender ID different from Trystero `MessageContext.peerId`.

### Engine

- Start, sequential advance, explicit transition, both choices and endings.
- Conditions, set/increment effects, unavailable choice, choice-required error.
- Dead-end choice set: `canAdvance` false, `advance` throws `CHOICE_DEAD_END`.
- End-of-branch, restart, controller change, history bound, story mismatch.
- Immutability and determinism (same inputs → identical output) — load-bearing for replica replay.

### Sync service

- `inspectProgression`: apply exact next revision; ignore duplicate/stale; recover on gap; **reject progression events from any peer that is not the current controller**.
- `inspect*` purity: an inspected-but-uncommitted envelope is not a duplicate on retransmit; only `commit()` records it.
- `authorizeSnapshot`:
  - **forged `STATE_SNAPSHOT` from a non-controller participant with same session is rejected** (the Revision 2 hole);
  - solicited bootstrap response (matching `requestActionId`) accepted at null state; **unsolicited snapshot at null state rejected**;
  - cross-session snapshot accepted only from the current controller;
  - `RESTARTED` only from controller at exactly `revision + 1`; stale/forged restarts rejected.
- `SESSION_STARTED` arbitration: on revision-0 collision every inspector keeps the lexicographically smaller controller, including at the losing starter.
- `authorizeControllerChange`:
  - accepted only when sender == announced controller == **locally computed winner** and the old controller is absent;
  - **self-nominated non-winner rejected**;
  - rejected while the old controller is still connected;
  - supersession: equal-revision announcement with lower peer ID replaces an applied one; higher revision always wins; replicas converge on one controller from conflicting orders of delivery.
- `electController` order-independence; `chooseElectionState` picks highest revision then lowest controller ID.
- Stale `RESTART_REQUEST`/`ADVANCE_REQUEST`/`CHOICE_REQUEST` (wrong `expectedRevision`) produce a snapshot reply, not a transition.
- Concurrent same-revision requests yield one canonical transition (queue serialization).

### Dispatcher (hook-level)

- **Exhaustive dispatch:** `ERROR` and `CONTROL_PASSED` never mutate revision/timestamp/state; `CONTROL_REQUEST` is rejected and **not committed**; a synthetic unknown action type is rejected.
- **Engine replay:** an `ADVANCED`/`CHOICE_RESOLVED` whose payload disagrees with local replay (wrong scene, wrong variables) is not applied and triggers recovery.
- Recovery targeting: gap during migration requests a snapshot from the event sender, not the departed controller.

## Key sync-service cases (sketch)

```ts
it('rejects a forged snapshot from a participant', () => {
  const service = new VisualNovelSyncService()
  const state = makeState({ revision: 5, controllerPeerId: 'peer-ctl' })
  const forged = makeSnapshot({ ...state, revision: 9 })
  expect(service.authorizeSnapshot(
    makeEnvelope({ actionType: 'STATE_SNAPSHOT', senderPeerId: 'peer-evil' }),
    forged, state, 'peer-evil', null
  )).toBe(false)
})

it('accepts CONTROLLER_CHANGED only from the locally computed winner', () => {
  const service = new VisualNovelSyncService()
  const state = makeState({ revision: 5, controllerPeerId: 'peer-gone' })
  const envelope = (sender: string) => makeEnvelope({
    actionType: 'CONTROLLER_CHANGED', senderPeerId: sender, revision: 6,
    payload: { controllerPeerId: sender },
  })
  // self is peer-b; remaining peers are peer-c → winner is peer-b
  expect(service.authorizeControllerChange(
    envelope('peer-c'), state, 'peer-c', 'peer-b', ['peer-c'], null
  )).toBe(false) // self-nomination by non-winner
  expect(service.authorizeControllerChange(
    envelope('peer-a'), state, 'peer-a', 'peer-b', ['peer-a', 'peer-c'], null
  )).toBe(true) // peer-a is the computed winner
})

it('supersedes an equal-revision announcement with a lower peer ID', () => {
  const service = new VisualNovelSyncService()
  const state = makeState({ revision: 5, controllerPeerId: 'peer-gone' })
  const applied = { revision: 6, controllerPeerId: 'peer-b' }
  expect(service.authorizeControllerChange(
    makeEnvelope({ actionType: 'CONTROLLER_CHANGED', senderPeerId: 'peer-a',
      revision: 6, payload: { controllerPeerId: 'peer-a' } }),
    state, 'peer-a', 'peer-z', ['peer-a'], applied
  )).toBe(true)
})

it('arbitrates simultaneous revision-0 sessions deterministically', () => {
  const service = new VisualNovelSyncService()
  const mine = makeState({ revision: 0, controllerPeerId: 'peer-b', sessionId: 's-b' })
  const theirs = makeSnapshot({ revision: 0, controllerPeerId: 'peer-a', sessionId: 's-a' })
  expect(service.authorizeSnapshot(
    makeEnvelope({ actionType: 'SESSION_STARTED', senderPeerId: 'peer-a' }),
    theirs, mine, 'peer-a', null
  )).toBe(true) // peer-a < peer-b: adopt theirs, discard own
})
```

## In-memory transport for hook tests

Implements `VisualNovelTransport` (03) — not a fake `PeerRoom`. Receiver **sets** per action key (matching the real `EventTarget` semantics where multiple receivers coexist and each `connectReceiver` returns its own unsubscribe), keyed join/leave handler maps, and a real `disconnect()` that removes the peer from the mesh and fires every remaining peer's leave handlers.

```ts
class TestTransport implements VisualNovelTransport {
  private receivers = new Map<string, Set<(data: unknown, context: MessageContext) => void>>()
  private joinHandlers = new Map<PeerHookType, (peerId: string) => void>()
  private leaveHandlers = new Map<PeerHookType, (peerId: string) => void>()

  constructor(
    readonly peerId: string,
    private readonly mesh: Map<string, TestTransport>
  ) {
    for (const other of mesh.values()) {
      for (const handler of other.joinHandlers.values()) handler(peerId)
    }
    mesh.set(peerId, this)
  }

  getSelfId = () => this.peerId

  getPeers = () => [...this.mesh.keys()].filter(id => id !== this.peerId)

  makeAction<T extends DataPayload>(peerAction: PeerAction, namespace: string) {
    const key = `${namespace}.${peerAction}`
    if (!this.receivers.has(key)) this.receivers.set(key, new Set())
    const send = async (data: T, options?: { target?: string | string[] }) => {
      const targets = options?.target
        ? (Array.isArray(options.target) ? options.target : [options.target])
        : this.getPeers()
      for (const target of targets) {
        for (const receiver of this.mesh.get(target)?.receivers.get(key) ?? []) {
          receiver(structuredClone(data), { peerId: this.peerId } as MessageContext)
        }
      }
    }
    const connectReceiver = (receiver: (data: T, context: MessageContext) => void) => {
      this.receivers.get(key)!.add(receiver as never)
      return () => this.receivers.get(key)!.delete(receiver as never)
    }
    const progress = (_fn: unknown) => {}
    return [send, connectReceiver, progress] as const
  }

  onPeerJoin = (type: PeerHookType, handler: (peerId: string) => void) => {
    this.joinHandlers.set(type, handler)
  }
  onPeerLeave = (type: PeerHookType, handler: (peerId: string) => void) => {
    this.leaveHandlers.set(type, handler)
  }
  removePeerJoinHandler = (type: PeerHookType) => this.joinHandlers.delete(type)
  removePeerLeaveHandler = (type: PeerHookType) => this.leaveHandlers.delete(type)

  // Simulates a transport departure: removes this peer and fires leave
  // handlers on every remaining peer — the trigger for election tests.
  disconnect = () => {
    this.mesh.delete(this.peerId)
    for (const other of this.mesh.values()) {
      for (const handler of other.leaveHandlers.values()) handler(this.peerId)
    }
  }
}
```

Mount controller and participant hooks on a shared mesh (use fake timers for the election window and request timeout) and assert:

- targeted requests, one broadcast, equal states;
- duplicate suppression only after commit;
- revision-gap recovery, with the request targeted correctly during migration;
- bootstrap late join: participant mounts with null state, sends bootstrap `STATE_REQUEST`, accepts only the snapshot echoing its `requestActionId`, converges;
- an unsolicited snapshot pushed to a null-state peer by a non-controller is ignored;
- `SESSION_STARTED` reaches peers already present; simultaneous starts converge on the lower controller ID;
- **election handshake:** `controller.disconnect()` → non-winners advertise to the computed winner; the winner adopts the highest advertised revision, announces once, and all replicas converge on the same controller and state — including when the winner was a revision behind;
- a non-winner broadcasting `CONTROLLER_CHANGED` is rejected by every replica;
- participant request timeout re-enables the UI after `requestTimeoutMs`;
- send failure on a canonical event triggers retry then snapshot repair (make `send` reject once).

## Component tests

Unchanged cases from Revision 2 (dialogue render, choice request, lobby, asset fallback, status states, controller badge, pending controls, restart dialog, keyboard focus order, mobile view switching), plus:

- start buttons disabled for non-controllers when a session exists (`canStartStory`);
- controller sees "pass control"/"end story", not bare "leave story", while participants remain;
- `SESSION_ENDED` returns every peer to the lobby.

## `e2e/tests/visual-novel.test.ts`

E2E specs live under `e2e/tests/` with a `.test.ts` suffix, matching the existing suite. Use the room-URL helpers from `e2e/helpers`.

```ts
import { expect, test } from '@playwright/test'

test('two peers share a branch and survive controller departure', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const a = await contextA.newPage()
  const b = await contextB.newPage()
  const roomUrl = '/public/novella-e2e' // use the repo's e2e room helpers

  await Promise.all([a.goto(roomUrl), b.goto(roomUrl)])
  await a.getByRole('button', { name: 'Start Harbour Lights' }).click()
  await expect(b.getByText('The harbour beacon is dark')).toBeVisible()

  await b.getByRole('button', { name: 'Continue' }).click()
  await expect(a.getByText('What should we do?')).toBeVisible()
  await b.getByRole('button', { name: /Light the old beacon/ }).click()
  await expect(a.getByText('The lens catches')).toBeVisible()
  await expect(b.getByText('The lens catches')).toBeVisible()

  await contextA.close()
  await expect(b.getByText(/You control the story/i)).toBeVisible()
  await b.getByRole('button', { name: 'Continue' }).click()
  await expect(b.getByText('They found the channel')).toBeVisible()
})

test('late join and refresh recover the current snapshot', async ({ browser }) => {
  // Start and progress in A, join with B (null state → bootstrap request),
  // compare scene/dialogue/revision, reload B, then assert the same
  // canonical state returns (checkpoint pointer + snapshot convergence).
})
```

## Existing-feature regressions

- Send chat before/during/after story transitions.
- Start/stop microphone while choices are visible.
- Video and screen share **display** (`RoomVideoDisplay`) remains rendered and functional alongside an active story.
- **Open a DM dialog during an active story: the DM room mounts no novella receiver, sends no bootstrap request, and does not disturb the group-room replica or lifecycle handlers.**
- File sharing and direct-message navigation remain functional.
- Exercise public and password-protected rooms without logging secrets.
- Removing the novella handlers does not flush audio/video/chat lifecycle handlers (keyed removal, not `flush()`).

## Manual matrix

### Two windows / different profiles

1. Start the normal development stack.
2. Join the same room in isolated profiles.
3. Confirm voice and text chat.
4. Start the example story and request actions from both peers.
5. Attempt to start a different story from the participant — must be refused locally and have no effect on the controller.
6. Confirm identical scene/dialogue/revision after every action.
7. Refresh the participant and verify checkpoint continuity plus bootstrap snapshot recovery.
8. Close the controller and verify the election handshake converges without restart.
9. End the story from the controller and verify both peers return to the lobby.

### Same-network devices

Use an HTTPS/secure-context development URL. Test portrait/landscape, microphone permissions, backgrounding, and reconnect.

### Different-network devices

Test with configured TURN. Record direct/relay status and latency. A failed peer connection without working TURN is a connectivity limitation, not necessarily a novella protocol defect.

## README additions

- Normal local startup and two-profile test setup.
- Starting a story using the existing room URL.
- Controller/request/revision/snapshot/election semantics: the authorization matrix and the election handshake.
- Story schema, safe asset rules, catalog registration, and example.
- Late join (bootstrap request), refresh, checkpoint pointer behavior.
- Browser autoplay and independent story volume controls.
- Tracker/STUN/TURN/ad-blocker/cross-domain limitations.
- Privacy statement: no central progress storage, accounts, or analytics.

## Rollout sequence

1. Merge pure models/deep validators/engine/story behind no visible UI.
2. Add local-only UI behind a development feature flag.
3. Add two-peer sync with the authorization matrix, exhaustive dispatch, `SESSION_STARTED` bootstrap/arbitration, snapshots, and recovery tests.
4. Add the election handshake, session lifecycle, and concurrency hardening.
5. Enable bundled example story by default after full regression pass.

## Command gate

```bash
npm test -- --run
npm run check:types
npm run lint
npm run build
npm run test:e2e -- e2e/tests/visual-novel.test.ts
```

Review the final diff for secrets, private URLs, external trackers, analytics, raw HTML, executable story content, unbounded payloads, unlicensed assets, duplicate room/microphone creation, and unrelated formatting.
