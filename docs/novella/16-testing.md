# 16 — Testing: matrices and the transport test mesh

> **Revision 6 changes:** the mesh gains what the remaining failure modes require — **per-peer link views** (B and C can observe different electorates), **queued deliveries with a manual pump** (reorder, delay, drop), **partial-send crash points** (a broadcast that reaches a subset and then the sender "crashes" — the termination and start-decision counterexamples), and **one-way links / temporary partitions**. A globally shared mesh with immediate synchronous delivery could not express any of the scenarios that motivated Revisions 5–6. Matrices updated for decision recovery, divergent-view elections, termination acks, and persisted meta. CI: these suites must run as visible GitHub status checks (17).

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

- **Decided-epoch guard (Revision 6):** with epoch 1 committed, a delayed epoch-1 `START_PROPOSE` is gate-dropped (`≤` semantics, embedded-session tombstone check) — no round reopens, nothing is restamped to epoch 2.
- **Commit sender authorization at null state:** a `START_COMMITTED` from a non-coordinator is rejected by a null-state peer; one from the proposal-target coordinator is accepted after the local view shifted.
- **No reset after progression:** installed A at revision 10 + same-epoch revision-0 commit for B from the current coordinator → rejected, sender receives A's snapshot.
- **Partial-commit recovery (reviewer scenario, via `deliverPartiallyThenCrash`):** C commits A to D only and crashes; C′ commits B; permute deliveries/partitions — every peer converges on one session after `heal()`; D's held commit answers a re-proposal.
- **Both-progressed partition heal:** progress A and B in disjoint partitions, `heal()` → deterministic `(controllerPeerId, sessionId)` winner, loser adopts via snapshot.
- Three starters × delivery permutations (`pumpReordered`) → one session everywhere; coordinator crash → re-proposal path; replayed commit = duplicate; `switchSession` cases incl. tombstone persistence across simulated reload.

## Election round (10)

- **Round ID validity:** generated `roundId` passes `isId` for 1–64-member electorates (property test); digest binding — tampered electorate/departed/epoch fields are rejected structurally.
- **Divergent views converge (reviewer scenario, via `setLink`):** B observes `{B, C}`, C observes `{C}`; both announce; every delivery order converges all replicas on the same winner via the total supersession order — no mutual `wrong-round` deadlock, no join/leave needed.
- **Epoch resurrection blocked:** after S1→S2 switch, lagging S1@20 advertiser cannot win; no replica re-installs S1 — **including after a simulated full-room reload** (persisted `RoomMeta`).
- Local-round behavior: join mid-round defers; member leave restarts; winner crash → restarted announcement supersedes.
- Not-winner-of-own-electorate / sender mismatch / wrong departure / departed-still-connected / `(epoch, revision)` regression rejected; post-application supersession converges replicas that applied in different orders; missed-leave replica converges without a local round; replayed announcement = duplicate.

## Termination (11)

- **Ack round:** 3 recipients, envelope delivered to 2 (`dropWhere`) — round stays pending; the third's `ADVANCE_REQUEST` gets the end envelope; its ack completes the round; only then tombstone + cleared state + checkpoint.
- **"Send resolved" regression:** `send` resolves on enqueue with zero deliveries pumped — the round must remain pending (the Revision 5 counterexample).
- **Departure completes:** never-acking recipient disconnects → removed from the frozen set → finalize.
- **Duplicate end re-acks:** applied replica re-acks a resent end envelope; controller's `acked` set converges despite dropped acks.
- **Retained notice after finalization and reload:** post-finalize (and after `RoomMeta` reload), a stale peer's `STATE_REQUEST` receives the end notice.
- Ack hygiene (wrong `endActionId`, no pending round → ignored, uncommitted); controller crash mid-round → survivors elect and finish; `canStartStory` false while pending; delayed old end vs. restarted session; **rejoin race** (participation ref) carries over.

## Dispatcher (12)

- Exhaustive dispatch; `ERROR`/`CONTROL_PASSED` never mutate; `CONTROL_REQUEST` rejected, not committed; engine-replay mismatch → recovery; recovery targets the sender when the controller is gone; `CONTROLLER_CHANGED` installs atomically (a two-behind replica converges in one step); send-failure retry then snapshot repair; request timeout re-enables the UI.

## Persistence integration (13/15)

- **Async scope:** the checkpoint hook and sync mount wait for the `crypto.subtle` digest to resolve (`roomScope: string | null`); nothing touches storage with a null scope.
- **RoomMeta round-trip:** simulated full-room reload — service constructed from persisted `{highWaterEpoch: 5, endedSessions}`; the next start gets epoch 6; ended sessions stay dead; `onMetaChange` fires on every `noteEpoch`/`tombstone`.
- Mount → `loadLatest()` → provisional preview rendered read-only; canonical arrival calls `acceptCanonical` and clears the preview.
- **Start gating vs. provisional:** `canStartStory` is false until persistence settles and while a provisional session exists; `discardProvisional` clears it and re-enables starts.
- `onSessionEnded` actually calls `clear(sessionId)` (spy on the adapter); stale-session replacement clears the replaced session's checkpoint; corrupted/foreign-story/ended-session checkpoints are discarded on load; "Reset local novella data" clears checkpoints **and** meta.

## Transport test mesh

Implements `VisualNovelTransport` (07): receiver **sets** per action key, keyed join/leave handler maps, insert-before-notify, a real `disconnect()`, and the **correct generic constraint**. On top of the Revision 5 base, the mesh routes every delivery through a **link layer**:

```ts
// Per-ordered-pair link state — the unit every new failure mode needs.
type LinkState = 'up' | 'down'
interface QueuedDelivery {
  from: string; to: string; key: string
  data: unknown
  deliver: () => void
}

class TestMeshNetwork {
  private links = new Map<string, LinkState>()      // `${from}->${to}`, one-way
  private queue: QueuedDelivery[] = []
  auto = false                                       // true: pump on enqueue

  setLink(from: string, to: string, state: LinkState) { /* one-way */ }
  partition(groupA: string[], groupB: string[]) { /* both directions down */ }
  heal() { /* all links up */ }

  enqueue(delivery: QueuedDelivery) {
    if (this.links.get(`${delivery.from}->${delivery.to}`) === 'down') return // drop
    this.queue.push(delivery)
    if (this.auto) this.pump()
  }
  pump(count = Infinity) { /* deliver in order */ }
  pumpReordered(order: number[]) { /* deliver a permutation */ }
  dropWhere(match: (d: QueuedDelivery) => boolean) { /* selective loss */ }

  // Partial-send crash point: deliver the sender's queued broadcast to only
  // `recipients`, then disconnect the sender — the exact shape of "coordinator
  // commits to one peer and dies" (09) and "send resolved ≠ everyone applied" (11).
  deliverPartiallyThenCrash(sender: string, recipients: string[]) { /* ... */ }
}
```

`TestTransport.getPeers()` consults the link layer (a peer only "sees" peers it has an up-link to), so **B and C can honestly observe different electorates** — the divergent-views election scenario (10) is now directly expressible. `send` resolves once deliveries are *enqueued*, deliberately reproducing "broadcast promise resolved but nobody applied yet" for the termination regression test (11). Acks are ordinary envelopes and can be dropped or delayed like anything else.

Core `TestTransport` (per peer, unchanged shape plus the network hook):

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
