# 16 — Testing: matrices and the transport test mesh

> **Revision 5 changes:** the test transport's `makeAction` now declares **`<T extends DataPayload>`** with the import (the Revision 4 unconstrained `<T,>` failed `PeerRoomAction<T>`'s own constraint and could not type-check). New matrices cover start rounds, epochs, frozen elections, termination, the pre-dispatch gate, engine transport limits, and the ref-based rejoin race. CI note: wire these suites into the repository's existing GitHub checks so the PR shows status runs (00/M5).

## Validator matrix (03/04)

Revision 4 set (round-trip normalization incl. nested aliasing; cyclic input; aggregate worst-case-encoding byte budgets; cross-field mismatches; malformed collection elements; bootstrap scope; identity mismatch; semantic scene/entry/history checks; story-unavailable recovery; checkpoint invalidation) plus:

- `sessionEpoch` missing/0/negative/non-integer rejected in every state-carrying payload.
- `START_PROPOSE`/`START_COMMITTED`: candidate/state revision ≠ 0, proposer-candidate controller ≠ sender, bad `roundId`, non-bootstrap envelope scope → rejected.
- `CONTROLLER_CHANGED`: missing/empty/oversized/invalid `electorate`, bad `roundId`, state/controller/sender mismatch → rejected; normalized electorate is a fresh copy.
- Story rule 13: a story with > `maxEffectVariables` distinct effect variables, or a worst-case reachable variable map exceeding `maxVariablesBytes`, rejected at load.

## Engine matrix (05)

Revision 4 set (transitions, endings, effects, dead ends, `STORY_ENDED`, `STORY_MISMATCH`, history bounding, determinism, immutability) plus:

- `VARIABLES_LIMIT`: a choice that would create variable #129, or push `utf8Bytes(variables)` past `maxVariablesBytes`, throws and leaves state unchanged.
- `INVALID_INCREMENT` on non-finite results (`Number.MAX_VALUE + Number.MAX_VALUE`).
- **Engine/validator consistency property:** for a corpus of valid stories and random walks, every state the engine emits passes `validateSessionState` after `toSnapshotState` — the deadlock class is empty by construction.
- `start`/`restart` carry `sessionEpoch` through unchanged.

## Sync service matrix (08)

- **Gate:** tombstoned-session envelopes never reach handlers (`SESSION_STARTED`, `START_PROPOSE`, `RESTARTED`, progression); the sole exception `STATE_REQUEST` passes; committed action IDs are dropped pre-dispatch; `isStaleEpoch` drops any state-carrying envelope embedding an epoch below `latestEpoch`.
- Purity/commit-after-apply; progression rules; request rules; solicited-snapshot rules — carried over.
- Epoch ordering: `chooseElectionState([S1@e1r20, S2@e2r0])` → S2; cross-session snapshot below current epoch rejected even from the controller; `SESSION_STARTED` switch requires exactly `epoch + 1`, revision 0.

## Start round (09)

- **Reviewer divergence scenario:** coordinator sees only A's proposal; B's proposal delayed past the commit — both peers converge on A's session; B never has its own session installed; B's late proposal is epoch-dropped.
- Three starters × every proposal/commit delivery permutation → one session everywhere.
- Coordinator crash before commit → re-proposal to next coordinator; exactly one commit installs.
- Dual-coordinator same-epoch commits → `(controllerPeerId, sessionId)` tie-break converges all replicas.
- Replayed commit = duplicate; delayed proposal after commit = epoch-dropped; proposal for a tombstoned session = gate-dropped.
- `switchSession`: non-controller refused locally and by replicas; stale `expectedRevision` refused; success tombstones the old session, increments epoch, clears the old checkpoint; old-session stragglers ignored.

## Election round (10)

- **Epoch resurrection blocked:** after S1→S2 switch, lagging S1@20 advertiser cannot win; no replica re-installs S1.
- **Frozen winner under join:** lower-ID peer joins mid-round; every replica still accepts the frozen winner's announcement; joiner bootstraps afterward.
- Mid-round leave restarts the round deterministically; old-round announcements fail `wrong-round` everywhere; winner-crash restart converges.
- Non-winner / self-nominated announcements rejected; departed-still-connected rejected; adopted-state `(epoch, revision)` regression rejected; post-application supersession within one round converges replicas that applied in different orders; missed-leave replica converges via implicit open; replayed announcement = duplicate.

## Termination (11)

- End-send failure: controller retains state/authority; participant requests answered with the persisted end envelope (same `actionId`); after successful resend all peers reach the lobby, controller finalizes (tombstone + cleared state + checkpoint).
- No election while the ending controller is connected; controller disconnect mid-pending → remaining live replicas elect and can finish the end.
- `canStartStory` false while pending; delayed old end cannot clear a restarted session; late events for the ended session gate-dropped; post-end `STATE_REQUEST` receives the end notice, not a snapshot.
- **Rejoin race:** synchronous transport delivers the bootstrap snapshot during the `rejoinSession` send → applied (participation ref updated pre-send); leave durable across incoming traffic.

## Dispatcher (12)

- Exhaustive dispatch; `ERROR`/`CONTROL_PASSED` never mutate; `CONTROL_REQUEST` rejected, not committed; engine-replay mismatch → recovery; recovery targets the sender when the controller is gone; `CONTROLLER_CHANGED` installs atomically (a two-behind replica converges in one step); send-failure retry then snapshot repair; request timeout re-enables the UI.

## Persistence integration (13/15)

- Mount → `loadLatest()` → provisional preview rendered read-only; canonical arrival calls `acceptCanonical` and clears the preview.
- `onSessionEnded` actually calls `clear(sessionId)` (spy on the adapter); stale-session replacement clears the replaced session's checkpoint; corrupted/foreign-story/ended-session checkpoints are discarded on load.

## Transport test mesh

Implements `VisualNovelTransport` (07): receiver **sets** per action key, keyed join/leave handler maps, insert-before-notify, a real `disconnect()`, and the **correct generic constraint**:

```ts
import type { DataPayload, MessageContext } from 'trystero'
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
    // ORDER MATTERS: insert FIRST, then notify — a join handler that
    // immediately sends a targeted message (the controller's snapshot push)
    // must find the new peer in the mesh.
    mesh.set(peerId, this)
    for (const other of mesh.values()) {
      if (other === this) continue
      for (const handler of other.joinHandlers.values()) handler(peerId)
    }
  }

  getSelfId = () => this.peerId

  getPeers = () => [...this.mesh.keys()].filter(id => id !== this.peerId)

  // Constrained generic — PeerRoomAction<T> itself requires T extends
  // DataPayload, so an unconstrained <T,> cannot type-check.
  makeAction = <T extends DataPayload>(
    peerAction: PeerAction,
    namespace: string
  ): PeerRoomAction<T> => {
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

  // Transport departure: removes this peer and fires every remaining peer's
  // leave handlers — the trigger for election tests.
  disconnect = () => {
    this.mesh.delete(this.peerId)
    for (const other of this.mesh.values()) {
      for (const handler of other.leaveHandlers.values()) handler(this.peerId)
    }
  }
}
```

Add a compile-only test that assigns `new TestTransport(...)` to a `VisualNovelTransport`-typed binding and passes a `usePeerAction`-compatible payload type through `makeAction` — locking the generic constraint in `check:types`.

Mesh-level integration cases use fake timers for `startRoundMs`, `electionRoundMs`, and `requestTimeoutMs`; delivery-order permutations come from wrapping `send` with a reorderable queue.

## Component tests

Revision 4 set plus: start buttons disabled during `starting` and pending termination; provisional preview rendered read-only and labeled; "Rejoin story" notice; controller menu shows "Switch story…"/"Pass control"/"End story for everyone"; `SESSION_ENDED` returns every peer to the lobby.

## `e2e/tests/visual-novel.test.ts`

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

test('simultaneous starts converge on one session', async ({ browser }) => {
  // Click start in A and B at once; assert both land on the same
  // session/story (coordinator commit) and progression works afterward.
})

test('ending the story reaches everyone and survives reload', async ({ browser }) => {
  // Controller ends; both peers reach the lobby; reload both and assert the
  // ended session does not resurrect from checkpoints.
})

test('late join and refresh recover the current snapshot', async ({ browser }) => {
  // Progress in A; join B (bootstrap); compare scene/dialogue/revision;
  // reload B; assert provisional preview then canonical convergence.
})
```
