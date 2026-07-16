# 06 — Tests, manual validation, and rollout

> **Revision 2 changes:** `TestPeerRoom.makeAction` now matches the real `PeerRoomAction` 3-tuple (`[sender, connectReceiver, progress]`, where `connectReceiver` returns the unsubscribe function — verified against `usePeerAction.ts`); E2E specs live at `e2e/tests/visual-novel.test.ts` matching the repository layout; new test cases cover the revision-2 protocol fixes (migration acceptance, bootstrap requests, post-apply duplicate commit, story switch, restart revision check, dead-end choices, request timeout).

## Unit-test matrix

### Validator

- Valid complete story and every action payload.
- Missing start scene, empty dialogue, duplicate IDs, nonexistent transitions.
- Unknown asset keys, path traversal, external origins, unsupported extensions.
- Unknown action/effect/operator, unsupported protocol, invalid numbers.
- Oversized envelope, snapshot, history, variables, variable values, text, and identifiers.
- `toSnapshotState` truncation and byte-limit consistency (maximal legal truncated state passes).
- Bootstrap-scoped `STATE_REQUEST` envelope is valid.
- Envelope sender ID different from Trystero `MessageContext.peerId`.

### Engine

- Start, sequential advance, explicit transition, both choices and endings.
- Conditions, set/increment effects, unavailable choice, choice-required error.
- **Dead-end choice set: entry declares choices, all condition-gated off → `canAdvance` false, `advance` throws `CHOICE_DEAD_END`, branch is never skipped.**
- End-of-branch, restart, controller change, history bound, story mismatch.
- Immutability: input state and manifest are not mutated.

### Sync service

- Apply exact next revision, ignore duplicate/stale, recover on gap.
- Reject story/version/session/controller/sender mismatch.
- **`inspect*` methods are pure: an inspected-but-uncommitted envelope is not treated as duplicate on retransmit; only `commit()` records it.**
- **Snapshot for a different session/story reaches `apply` (story switching); non-snapshot cross-story events still reject.**
- **`STATE_REQUEST` with bootstrap scope passes `inspectRequest` at the controller; other request types still require session match.**
- **`isAcceptableControllerChange`: accepted when sender == announced controller, old controller absent, revision exactly next; rejected when the old controller is still connected or the revision is wrong.**
- Target late-join snapshot and accept only valid snapshots.
- Deterministic election and highest-revision state choice.
- Concurrent same-revision requests yield one canonical transition (promise-queue serialization).
- **Stale `RESTART_REQUEST` (wrong `expectedRevision`) produces a snapshot reply, not a restart.**

## `VisualNovelEngine.test.ts`

```ts
describe('VisualNovelEngine', () => {
  const makeEngine = () => new VisualNovelEngine(exampleStory, { now: () => 1234 })

  it.each([
    ['light-beacon', 'beacon-ending', { usedBeacon: true, courage: 1 }],
    ['wait-for-dawn', 'dawn-ending', { usedBeacon: false, patience: 1 }],
  ])('resolves %s canonically', (choiceId, sceneId, variables) => {
    const engine = makeEngine()
    const atChoice = engine.advance(engine.start('session-1', 'peer-a'))
    const result = engine.choose(atChoice, choiceId)
    expect(result).toMatchObject({ sceneId, variables, revision: 2 })
    expect(atChoice.sceneId).toBe('pier')
  })

  it('requires a choice instead of advancing past it', () => {
    const engine = makeEngine()
    const atChoice = engine.advance(engine.start('session-1', 'peer-a'))
    expect(() => engine.advance(atChoice)).toThrow('Resolve a choice')
  })
})
```

## `VisualNovelSyncService.test.ts`

```ts
it('requests recovery for an event gap', () => {
  const service = new VisualNovelSyncService()
  const result = service.inspectCanonical(
    makeEnvelope({ revision: 4, senderPeerId: 'peer-a', actionType: 'ADVANCED' }),
    makeState({ revision: 2, controllerPeerId: 'peer-a' }),
    'peer-a'
  )
  expect(result).toEqual({ kind: 'recover', reason: 'revision-gap' })
})

it('treats an uncommitted envelope as fresh on retransmit', () => {
  const service = new VisualNovelSyncService()
  const envelope = makeEnvelope({ actionId: 'same', revision: 2, actionType: 'ADVANCED' })
  // First inspection did not lead to apply (e.g. payload failed validation
  // downstream) — commit() was never called.
  service.inspectCanonical(envelope, makeState({ revision: 1 }), 'peer-a')
  expect(service.inspectCanonical(envelope, makeState({ revision: 1 }), 'peer-a'))
    .toEqual({ kind: 'apply' })
})

it('ignores a committed duplicate', () => {
  const service = new VisualNovelSyncService()
  const envelope = makeEnvelope({ actionId: 'same', revision: 2, actionType: 'ADVANCED' })
  service.commit(envelope)
  expect(service.inspectCanonical(envelope, makeState({ revision: 1 }), 'peer-a'))
    .toEqual({ kind: 'ignore', reason: 'duplicate' })
})

it('elects the same peer regardless of input order', () => {
  const service = new VisualNovelSyncService()
  expect(service.electController(['peer-z', 'peer-a', 'peer-b'])).toBe('peer-a')
  expect(service.electController(['peer-b', 'peer-z', 'peer-a'])).toBe('peer-a')
})

it('accepts CONTROLLER_CHANGED from the elected successor', () => {
  const service = new VisualNovelSyncService()
  const state = makeState({ revision: 5, controllerPeerId: 'peer-gone' })
  const envelope = makeEnvelope({
    actionType: 'CONTROLLER_CHANGED',
    senderPeerId: 'peer-a',
    revision: 6,
    payload: { controllerPeerId: 'peer-a' },
  })
  expect(service.isAcceptableControllerChange(envelope, state, 'peer-a', ['peer-b']))
    .toBe(true)
  // Old controller still connected → refuse the coup.
  expect(service.isAcceptableControllerChange(envelope, state, 'peer-a', ['peer-gone']))
    .toBe(false)
})
```

## In-memory transport for hook tests

Matches the real `PeerRoomAction` shape: a 3-tuple whose receiver-connector returns its own unsubscribe function (see `PeerRoom.makeAction` / `usePeerAction`).

```ts
class TestPeerRoom {
  private receivers = new Map<string, (data: unknown, context: MessageContext) => void>()
  constructor(readonly peerId: string, private readonly mesh: Map<string, TestPeerRoom>) {
    mesh.set(peerId, this)
  }

  getSelfId = () => this.peerId

  getPeers = () => [...this.mesh.keys()].filter(id => id !== this.peerId)

  makeAction<T>(peerAction: PeerAction, namespace: string) {
    const key = `${namespace}.${peerAction}`
    const send = async (data: T, options?: { target?: string | string[] }) => {
      const targets = options?.target
        ? (Array.isArray(options.target) ? options.target : [options.target])
        : this.getPeers()
      for (const target of targets) {
        this.mesh.get(target)?.receivers.get(key)?.(
          structuredClone(data),
          { peerId: this.peerId } as MessageContext
        )
      }
    }
    const connectReceiver = (receiver: (data: T, context: MessageContext) => void) => {
      this.receivers.set(key, receiver as never)
      return () => this.receivers.delete(key)
    }
    const progress = (_fn: unknown) => {}
    return [send, connectReceiver, progress] as const
  }

  onPeerJoin = (_type: PeerHookType, _fn: unknown) => {}
  onPeerLeave = (_type: PeerHookType, _fn: unknown) => {}
  removePeerJoinHandler = (_type: PeerHookType) => {}
  removePeerLeaveHandler = (_type: PeerHookType) => {}
}
```

Use it to mount controller and participant hooks and assert:

- targeted requests, one broadcast, equal states;
- duplicate suppression only after commit;
- revision-gap recovery;
- **bootstrap late join: participant mounts with null state, sends bootstrap `STATE_REQUEST`, receives a truncated snapshot, converges;**
- **`SESSION_STARTED` reaches peers already present at story start;**
- **controller leave: survivor elects itself from transport peers, broadcasts `CONTROLLER_CHANGED`, and the other replica applies it;**
- **participant request timeout: no controller response re-enables the UI after `requestTimeoutMs`.**

## Component tests

```tsx
it('renders dialogue and submits a participant choice request', async () => {
  const choose = vi.fn().mockResolvedValue(undefined)
  render(
    <VisualNovelContext.Provider value={makeContext({
      entry: { id: 'pier-2', speaker: 'Sol', text: 'What should we do?' },
      availableChoices: [{ id: 'beacon', label: 'Light the beacon', nextSceneId: 'end' }],
      isController: false,
      choose,
    })}>
      <DialogueBox />
      <ChoiceList />
    </VisualNovelContext.Provider>
  )
  expect(screen.getByText('What should we do?')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: /Light the beacon/ }))
  expect(choose).toHaveBeenCalledWith('beacon')
})
```

Also test lobby, asset fallback, loading/sync/error/waiting states, controller badge, pending controls, restart dialog, keyboard focus order, and mobile Story/Chat switching.

## `e2e/tests/visual-novel.test.ts`

E2E specs live under `e2e/tests/` with a `.test.ts` suffix, matching the existing suite (`room.test.ts`, `home.test.ts`, …). Use the room-URL helpers from `e2e/helpers` rather than the illustrative literal below.

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
  // canonical state returns.
})
```

## Existing-feature regressions

- Send chat before/during/after story transitions.
- Start/stop microphone while choices are visible.
- Verify video remains optional and can start without remounting the story.
- Verify file sharing and direct-message navigation remain functional.
- Exercise public and password-protected rooms without logging secrets.
- Confirm removing the novella handlers does not flush audio/video/chat lifecycle handlers (keyed removal, not `flush()`).

## Manual matrix

### Two windows / different profiles

1. Start the normal development stack.
2. Join the same room in isolated profiles.
3. Confirm voice and text chat.
4. Start the example story and request actions from both peers.
5. Confirm identical scene/dialogue/revision after every action.
6. Refresh the participant and verify bootstrap snapshot recovery.
7. Close the controller and verify migration without restart — the survivor must actually apply `CONTROLLER_CHANGED`, not just broadcast it.

### Same-network devices

Use an HTTPS/secure-context development URL. Test portrait/landscape, microphone permissions, backgrounding, and reconnect.

### Different-network devices

Test with configured TURN. Record direct/relay status and latency. A failed peer connection without working TURN is a connectivity limitation, not necessarily a novella protocol defect.

## README additions

- Normal local startup and two-profile test setup.
- Starting a story using the existing room URL.
- Controller/request/revision/snapshot/election semantics, including the new-controller acceptance rule.
- Story schema, safe asset rules, catalog registration, and example.
- Late join (bootstrap request), refresh, and checkpoint behavior.
- Browser autoplay and independent story volume controls.
- Tracker/STUN/TURN/ad-blocker/cross-domain limitations.
- Privacy statement: no central progress storage, accounts, or analytics.

## Rollout sequence

1. Merge pure models/validator/engine/story behind no visible UI.
2. Add local-only UI behind a development feature flag.
3. Add two-peer sync, `SESSION_STARTED` bootstrap, snapshots, and recovery tests.
4. Add controller migration and concurrency hardening.
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
