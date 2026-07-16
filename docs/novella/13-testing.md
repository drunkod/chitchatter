# 13 — Testing: matrices and the transport test mesh

> **Revision 4 changes:** the test mesh fixes both review defects — the constructor **inserts the new transport into the mesh before firing join handlers** (a controller's join handler that immediately pushes a targeted snapshot no longer drops the message), and `makeAction` returns an explicitly typed **mutable** `PeerRoomAction<T>` instead of a readonly `as const` tuple. New matrices for election rounds, start arbitration, tombstones, participation, normalization/aliasing, worst-case byte encodings, and semantic snapshot validation.

## Validator matrix (03/04)

- Every action type round-trips; normalized value deep-equals semantic content; extra properties gone at every nesting level; **mutating the original input (including `payload.state.variables`) after validation does not affect the returned value**.
- Cyclic input at any level → clean failure, never a throw.
- Aggregate byte budgets: 128 variables × 256 worst-case-encoding chars (`''`) rejected despite each element passing; same for history vs `maxHistoryBytes`; maximal legal truncated state passes `validateSessionState` (consistency by construction, 01).
- `toSnapshotState` satisfies entry count **and** byte budget.
- Envelope/state cross-field mismatch rejected for all five state-carrying actions; `SESSION_STARTED` rev ≠ 0 or controller ≠ sender rejected; `CONTROLLER_CHANGED` internal mismatches rejected.
- Malformed history entries / `CHOICE_RESOLVED` variables rejected element-wise.
- Semantic (04): unknown scene/entry; history referencing unknown scene/entry/choice; non-increasing history revisions; last history revision ≥ state revision; story-not-in-catalog → recoverable, **never reaches `setState`**; checkpoint invalidated when the bundled story changed.
- Bootstrap `STATE_REQUEST` valid; transport identity mismatch rejected pre-mutation.

## Engine matrix (05)

Start/advance/choose/restart/changeController; both endings; conditions and effects; `CHOICE_REQUIRED`, `CHOICE_DEAD_END`, `CHOICE_UNAVAILABLE`, `STORY_ENDED`, `STORY_MISMATCH`, `INVALID_INCREMENT`; history bounding; determinism (same input → identical output) and immutability of state + manifest.

## Sync service matrix (08)

- `inspectProgression`: exact-next applies; duplicate/stale/tombstoned ignored; gap/missing-state/session-mismatch recover; non-controller sender rejected.
- Purity: inspected-but-uncommitted envelope is fresh on retransmit; only `commit()` records.
- `authorizeSnapshot`: forged same-session snapshot from a participant rejected; solicited bootstrap response accepted at null state; **unsolicited snapshot at null state rejected**; cross-session only from controller; `RESTARTED` only controller at exactly `+1`; tombstoned session always rejected.
- `SESSION_ENDED` (via progression rules): `+5` rejected, `+1` applied and tombstoned; a delayed old `SESSION_ENDED` cannot clear a newer restarted session; late `RESTARTED` for a tombstoned session ignored.
- Start arbitration: `chooseStartCandidate` total order `(controllerPeerId, sessionId)` — A/B collision converges in both arrival orders; duplicate starts from one controller converge on one session.
- Election: `electController` order-independence; `chooseElectionState` highest revision then lowest ID.
- `authorizeControllerChange` (round-scoped):
  - non-winner / self-nominated announcement rejected;
  - rejected while the departed controller is still connected;
  - adopted state regressing below the replica's revision rejected;
  - **post-application supersession**: apply B@6, then accept A@6 (A < B) within the round, reject B's re-announcement (`superseded`);
  - stale round key rejected; replica that missed the leave event converges via implicit round opening.

## Dispatcher matrix (09, hook-level)

- Exhaustive dispatch: `ERROR`/`CONTROL_PASSED` never mutate state; `CONTROL_REQUEST` rejected and **not committed**; synthetic unknown action rejected.
- Engine replay: `ADVANCED`/`CHOICE_RESOLVED` disagreeing with local replay (scene or variables) → not applied, recovery issued.
- Recovery targeting: gap during migration → request to the event sender, not the departed controller.
- `CONTROLLER_CHANGED` applies its embedded snapshot atomically: a replica two revisions behind converges in one step with correct scene/variables (no fake-revision/stale-content state).
- Participation: after `leaveStory`, incoming progression/snapshots/announcements for that session are ignored (no recovery loop, no silent rejoin); `rejoinStory` bootstraps.
- Arbitration: progression requests refused locally while `phase === 'arbitrating'`.
- Send-failure repair: make `send` reject once → retry; reject twice → snapshot repair broadcast.
- Request timeout re-enables the UI after `requestTimeoutMs` (fake timers).

## Transport test mesh

Implements `VisualNovelTransport` (07). Receiver **sets** per action key (the real `PeerRoom` uses an `EventTarget`; multiple receivers coexist and each `connectReceiver` returns its own unsubscribe). Join/leave handler maps and a real `disconnect()`.

```ts
import type { MessageContext } from 'trystero'
import type { PeerHookType, PeerRoomAction } from 'lib/PeerRoom'
import type { PeerAction } from 'models/network'
import type { VisualNovelTransport } from 'services/visualNovel'

type Receiver = (data: unknown, context: MessageContext) => void

export class TestTransport implements VisualNovelTransport {
  private receivers = new Map<string, Set<Receiver>>()
  private joinHandlers = new Map<PeerHookType, (peerId: string) => void>()
  private leaveHandlers = new Map<PeerHookType, (peerId: string) => void>()

  constructor(
    readonly peerId: string,
    private readonly mesh: Map<string, TestTransport>
  ) {
    // ORDER MATTERS: insert FIRST, then notify. A join handler that
    // immediately sends a targeted message to the new peer (the controller's
    // snapshot push does exactly this) must find it in the mesh.
    mesh.set(peerId, this)
    for (const other of mesh.values()) {
      if (other === this) continue
      for (const handler of other.joinHandlers.values()) handler(peerId)
    }
  }

  getSelfId = () => this.peerId

  getPeers = () => [...this.mesh.keys()].filter(id => id !== this.peerId)

  // Explicitly typed MUTABLE PeerRoomAction<T> — `as const` would produce a
  // readonly tuple that is not assignable to the repository type.
  makeAction = <T,>(peerAction: PeerAction, namespace: string): PeerRoomAction<T> => {
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

    const connectReceiver = (receiver: Receiver) => {
      this.receivers.get(key)!.add(receiver)
      return () => { this.receivers.get(key)!.delete(receiver) }
    }

    const progress = (_fn: unknown) => {}

    const action: PeerRoomAction<T> = [
      send as PeerRoomAction<T>[0],
      connectReceiver as PeerRoomAction<T>[1],
      progress as PeerRoomAction<T>[2],
    ]
    return action
  }

  onPeerJoin = (type: PeerHookType, handler: (peerId: string) => void) => {
    this.joinHandlers.set(type, handler)
  }
  onPeerLeave = (type: PeerHookType, handler: (peerId: string) => void) => {
    this.leaveHandlers.set(type, handler)
  }
  removePeerJoinHandler = (type: PeerHookType) => { this.joinHandlers.delete(type) }
  removePeerLeaveHandler = (type: PeerHookType) => { this.leaveHandlers.delete(type) }

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

Mesh-level integration cases (fake timers for `electionRoundMs`, `startArbitrationMs`, `requestTimeoutMs`):

- controller join-push works when the joiner connects **during** the push (insert-before-notify);
- targeted requests, one broadcast, equal states; duplicate suppression post-commit;
- bootstrap late join: only the snapshot echoing the outstanding `requestActionId` is accepted;
- unsolicited snapshot pushed to a null-state peer by a non-controller ignored;
- simultaneous starts on 3 peers converge on one session in every delivery order;
- **election round end-to-end:** controller `disconnect()` → advertisements → winner adopts highest advertised revision → single announcement → all replicas converge on the same controller **and full state**, including a replica that was two revisions behind;
- competing announcements (partition the mesh delivery order) converge via supersession;
- non-winner announcement rejected everywhere;
- `SESSION_ENDED` tombstone: late `RESTARTED` ignored; checkpoints cleared (12);
- participant leave is durable across an incoming `SESSION_STARTED`; rejoin works.

## Component tests

Revision 3 set (dialogue render, choice request, lobby, asset fallback, status states, controller badge, pending controls, restart dialog, keyboard focus order, mobile view switching) plus:

- start buttons disabled during arbitration and for non-controllers (`canStartStory`);
- "Rejoin story" notice shown when `participation.kind === 'left-current-session'`; story stage not rendered;
- controller sees "Pass control"/"End story for everyone", not bare "Leave story";
- `SESSION_ENDED` returns every peer to the lobby.

## `e2e/tests/visual-novel.test.ts`

Location matches the existing suite (`e2e/tests/*.test.ts`); use the room-URL helpers from `e2e/helpers`.

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
  // Start and progress in A; join with B (null state → bootstrap request);
  // compare scene/dialogue/revision; reload B; assert checkpoint continuity
  // then canonical convergence.
})

test('simultaneous starts converge on one session', async ({ browser }) => {
  // Click start in A and B within the arbitration window; assert both end on
  // the same session/story and progression works afterward.
})
```
