# 08 — Sync service: pre-dispatch gate and authorization matrix

> **Revision 6 changes:** the gate is now **action-aware where Revision 5's wasn't**. (a) *Epoch staleness:* start actions are dropped at `embedded.sessionEpoch ≤ latestEpoch` — the strict `<` let a delayed epoch-1 `START_PROPOSE` survive after epoch 1 was decided (`1 < 1` is false) and get restamped into epoch 2 by a fresh round. Other state-carrying actions keep `<` (same-epoch traffic is legitimate). (b) *Tombstones:* start actions are checked against the **embedded candidate's `sessionId`** — their envelopes carry the bootstrap scope, so the old gate was testing whether the literal string `"bootstrap"` was tombstoned. (c) The service is **initialized from persisted `RoomMeta`** (15): `latestEpoch` and tombstones survive full-room reloads, or epoch monotonicity was a fiction. `SESSION_END_ACK` added to the matrix.

`inspect*`/`authorize*` methods are pure; `commit(envelope)` records an action ID only after successful application/handling.

## Pre-dispatch gate (run once, in 12, before any handler)

```ts
// After structural validation + identity check, before dispatch:
if (sync.isTombstonedFor(envelope)) {
  // Exception: a peer that missed the end may still REQUEST state for a
  // tombstoned session — answered with the retained SESSION_ENDED notice (11).
  if (envelope.actionType !== 'STATE_REQUEST') return
}
if (sync.isDuplicate(envelope.actionId)) return
if (sync.isStaleEpoch(envelope)) return
```

```ts
// Tombstone check against the session the envelope is actually ABOUT:
// start actions carry the bootstrap outer scope, so envelope.sessionId is
// the literal "bootstrap" — the embedded candidate is what matters.
isTombstonedFor(envelope: VisualNovelActionEnvelope): boolean {
  const embedded = this.embeddedState(envelope) // state ?? candidate ?? null
  if (embedded && this.endedSessions.has(embedded.sessionId)) return true
  return this.endedSessions.has(envelope.sessionId)
}

// Action-aware epoch staleness. Start actions: a decided epoch may NEVER
// reopen, so ≤. Everything else: same-epoch traffic is normal, so <.
isStaleEpoch(envelope: VisualNovelActionEnvelope): boolean {
  const embedded = this.embeddedState(envelope)
  if (!embedded) return false
  const isStartAction = envelope.actionType === 'START_PROPOSE' ||
    envelope.actionType === 'START_COMMITTED'
  return isStartAction
    ? embedded.sessionEpoch <= this.latestEpoch
    : embedded.sessionEpoch < this.latestEpoch
}
```

**Worked example (the Revision 5 hole):** epoch 1 committed → `latestEpoch = 1` → delayed epoch-1 `START_PROPOSE` arrives → `1 ≤ 1` → dropped at the gate. It can no longer reach `handleStartPropose`, so no round reopens and no stale candidate is restamped to epoch 2. (`handleStartPropose` additionally requires `candidate.sessionEpoch === latestEpoch + 1` and null local state — defense in depth, 09.)

**Persistence:** the service constructor takes the persisted `RoomMeta` (15) — `latestEpoch = meta.highWaterEpoch`, `endedSessions` seeded from `meta.endedSessions` — and every `noteEpoch`/`tombstone` write-through updates the meta record. Without this, a full-room reload reset `latestEpoch` to 0, the next start received epoch 1, and any lagging peer's old epoch-5 state became "newer" while ended sessions were forgotten.

Handlers therefore do **not** re-implement these checks; narrow exceptions are stated on the matrix row (only `STATE_REQUEST` has one).

## Authorization matrix

`sender` = transport-verified `context.peerId`. Structural (03) + semantic (04) validation and the gate have already passed.

| Action | Authorized sender | Preconditions | Effect |
| --- | --- | --- | --- |
| `START_PROPOSE` | any peer with null state | self is the start coordinator (09); **self has null state**; candidate epoch = `latestEpoch + 1` (gate already dropped ≤) | candidate collected for the round |
| `START_COMMITTED` | **sender == `coordinatorPeerId` (structural, 03) AND sender is an acceptable coordinator for this peer** (09) | null state: install. Non-null same-epoch state: **only while the start decision is unresolved and local revision === 0**, via the `(controllerPeerId, sessionId)` tie-break — a progressed session is never reset (09) | **install fresh session** / reconcile |
| `STATE_REQUEST` | any peer | handled if self is controller — or if the session is tombstoned, answered with the persisted `SESSION_ENDED` (11); exempt from session match (bootstrap scope) | targeted snapshot / end notice |
| `ADVANCE_REQUEST` / `CHOICE_REQUEST` / `RESTART_REQUEST` | any peer | self is controller; session/story match; `expectedRevision === revision` (else snapshot reply); **no pending termination** (11) | engine transition + canonical broadcast |
| `CONTROL_REQUEST` | any peer | M3; until implemented: reject, no commit | `CONTROL_PASSED` |
| `STATE_SNAPSHOT` | current controller; **or** any peer iff it echoes our outstanding `requestActionId` *(crash-fault concession, 00)* | same session: `(epoch, revision) ≥` current; cross-session: controller only, epoch ≥ current | replace replica (atomic) |
| `SESSION_STARTED` | current controller only (**story switch**, 09) | `state.sessionEpoch === current.sessionEpoch + 1`; revision 0; old session tombstoned on apply | adopt switched session |
| `RESTARTED` | current controller only | same session; `revision === current.revision + 1` | replace replica |
| `ADVANCED` / `CHOICE_RESOLVED` | current controller only | same session/story; `revision === current.revision + 1`; **engine replay matches** | apply derived state |
| `SESSION_ENDED` | current controller only | same session; `revision === current.revision + 1` | tombstone (persisted, with retained notice); **ack the sender**; clear replica + checkpoint; lobby (11) |
| `SESSION_END_ACK` | any frozen-set recipient, targeted at the ending controller | echoes the pending end envelope's `actionId`; ignored unless a termination round is pending (11) | recipient marked acked |
| `CONTROLLER_CHANGED` | announced winner == sender == min of its own canonical electorate (structural + 10) | **internally consistent round fields + self-relevant conditions** — departed == my recorded controller and absent from my transport view; adopted `(epoch, revision)` not behind mine; **total supersession order across announcements**, not exact local-round equality (honest views may differ, 10) | apply adopted snapshot + controller atomically |
| `CONTROL_PASSED` | current controller only | `revision === current.revision + 1` (M3) | set controller |
| `ELECTION_ADVERTISE` | any remaining peer, targeted *(crash-fault concession, 00)* | self is the **local round's** winner; `roundId` matches the local round; state epoch = round epoch | candidate for adoption |
| `ERROR` | any peer | never mutates session state | surface to UI |
| anything else / future | — | — | **reject; do not commit** |

## `src/services/visualNovel/VisualNovelSyncService.ts` (core)

Round-specific logic lives with its protocol: start rounds in 09, election rounds in 10, termination in 11. The shared service:

```ts
import { visualNovelLimits } from 'config/visualNovel'
import type {
  VisualNovelActionEnvelope,
  VisualNovelSessionState,
} from 'models/visualNovel'

export type CanonicalDecision =
  | { kind: 'apply' }
  | { kind: 'ignore'; reason: 'duplicate' | 'stale' | 'tombstoned' | 'left' }
  | { kind: 'recover'; reason: 'missing-state' | 'session-mismatch' | 'revision-gap' }
  | { kind: 'reject'; reason: string }

const maxTombstones = 64
const stateCarrying = new Set([
  'START_PROPOSE', 'START_COMMITTED', 'STATE_SNAPSHOT', 'SESSION_STARTED',
  'RESTARTED', 'ELECTION_ADVERTISE', 'CONTROLLER_CHANGED',
])

export class VisualNovelSyncService {
  private readonly seen = new Map<string, number>()
  private readonly endedSessions = new Map<string, number>() // sessionId → epoch
  private latestEpoch: number

  // Initialized from persisted RoomMeta (15) — epoch monotonicity and
  // tombstones are safety data that must survive full-room reloads. Every
  // mutation below write-throughs via onMetaChange.
  constructor(
    meta: RoomMeta,
    private readonly onMetaChange: (meta: RoomMeta) => void
  ) {
    this.latestEpoch = meta.highWaterEpoch
    for (const ended of meta.endedSessions) {
      this.endedSessions.set(ended.sessionId, ended.epoch)
    }
  }

  // ---------- gate primitives ----------

  isDuplicate = (actionId: string) => this.seen.has(actionId)
  getLatestEpoch = () => this.latestEpoch

  private embeddedState(
    envelope: VisualNovelActionEnvelope
  ): VisualNovelSessionState | null {
    if (!stateCarrying.has(envelope.actionType)) return null
    const payload = envelope.payload as {
      state?: VisualNovelSessionState
      candidate?: VisualNovelSessionState
    }
    return payload.state ?? payload.candidate ?? null
  }

  // Start envelopes carry the bootstrap outer scope — check the session the
  // envelope is actually ABOUT, not the literal "bootstrap".
  isTombstonedFor(envelope: VisualNovelActionEnvelope): boolean {
    const embedded = this.embeddedState(envelope)
    if (embedded && this.endedSessions.has(embedded.sessionId)) return true
    return this.endedSessions.has(envelope.sessionId)
  }

  // Action-aware: decided epochs may never reopen (≤ for start actions);
  // same-epoch traffic is legitimate everywhere else (<).
  isStaleEpoch(envelope: VisualNovelActionEnvelope): boolean {
    const embedded = this.embeddedState(envelope)
    if (!embedded) return false
    const isStartAction = envelope.actionType === 'START_PROPOSE' ||
      envelope.actionType === 'START_COMMITTED'
    return isStartAction
      ? embedded.sessionEpoch <= this.latestEpoch
      : embedded.sessionEpoch < this.latestEpoch
  }

  noteEpoch(epoch: number) {
    if (epoch <= this.latestEpoch) return
    this.latestEpoch = epoch
    this.persistMeta()
  }

  tombstone(sessionId: string, epoch: number, endEnvelope?: VisualNovelActionEnvelope) {
    this.endedSessions.set(sessionId, epoch)
    if (endEnvelope) this.retainedEndNotices.set(sessionId, endEnvelope) // (11)
    if (epoch > this.latestEpoch) this.latestEpoch = epoch
    while (this.endedSessions.size > maxTombstones) {
      const oldest = this.endedSessions.keys().next().value
      if (!oldest) break
      this.endedSessions.delete(oldest)
      this.retainedEndNotices.delete(oldest)
    }
    this.persistMeta()
  }

  private readonly retainedEndNotices = new Map<string, VisualNovelActionEnvelope>()
  getRetainedEndNotice = (sessionId: string) =>
    this.retainedEndNotices.get(sessionId) ?? null

  private persistMeta() {
    this.onMetaChange({
      highWaterEpoch: this.latestEpoch,
      endedSessions: [...this.endedSessions.entries()].map(([sessionId, epoch]) => ({
        sessionId,
        epoch,
        endEnvelope: this.retainedEndNotices.get(sessionId)!,
      })).filter(entry => entry.endEnvelope),
    })
  }

  commit(envelope: VisualNovelActionEnvelope) {
    this.seen.set(envelope.actionId, envelope.timestamp)
    while (this.seen.size > visualNovelLimits.maxSeenActionIds) {
      const oldest = this.seen.keys().next().value
      if (!oldest) break
      this.seen.delete(oldest)
    }
  }

  // ---------- progression ----------
  // (ADVANCED / CHOICE_RESOLVED / RESTARTED / SESSION_ENDED / CONTROL_PASSED)
  // Gate has already handled tombstone/duplicate/epoch.

  inspectProgression(
    envelope: VisualNovelActionEnvelope,
    state: VisualNovelSessionState | null,
    transportPeerId: string
  ): CanonicalDecision {
    if (!state) return { kind: 'recover', reason: 'missing-state' }
    if (transportPeerId !== state.controllerPeerId) {
      return { kind: 'reject', reason: 'not-controller' }
    }
    if (envelope.storyId !== state.storyId ||
        envelope.storyVersion !== state.storyVersion) {
      return { kind: 'reject', reason: 'story-mismatch' }
    }
    if (envelope.sessionId !== state.sessionId) {
      return { kind: 'recover', reason: 'session-mismatch' }
    }
    if (envelope.revision <= state.revision) return { kind: 'ignore', reason: 'stale' }
    if (envelope.revision !== state.revision + 1) {
      return { kind: 'recover', reason: 'revision-gap' }
    }
    return { kind: 'apply' }
  }

  // ---------- requests (controller side) ----------

  inspectRequest(
    envelope: VisualNovelActionEnvelope,
    state: VisualNovelSessionState,
    transportPeerId: string,
    selfPeerId: string
  ): CanonicalDecision {
    if (state.controllerPeerId !== selfPeerId) {
      return { kind: 'reject', reason: 'not-controller' }
    }
    if (envelope.actionType !== 'STATE_REQUEST' &&
        (envelope.storyId !== state.storyId ||
         envelope.storyVersion !== state.storyVersion ||
         envelope.sessionId !== state.sessionId)) {
      return { kind: 'reject', reason: 'session-mismatch' }
    }
    return { kind: 'apply' }
  }

  // ---------- snapshots ----------

  authorizeSnapshot(
    envelope: VisualNovelActionEnvelope,
    snapshot: VisualNovelSessionState,
    current: VisualNovelSessionState | null,
    transportPeerId: string,
    outstandingRequestId: string | null
  ): boolean {
    if (envelope.actionType === 'STATE_SNAPSHOT') {
      const solicited = outstandingRequestId !== null &&
        (envelope.payload as { requestActionId?: string }).requestActionId ===
          outstandingRequestId
      if (!current) return solicited
      const fromController = transportPeerId === current.controllerPeerId
      const notBehind =
        snapshot.sessionEpoch > current.sessionEpoch ||
        (snapshot.sessionEpoch === current.sessionEpoch &&
          snapshot.revision >= current.revision)
      if (snapshot.sessionId === current.sessionId) {
        return (fromController || solicited) && notBehind
      }
      return fromController && notBehind // cross-session: controller + epoch order
    }
    if (envelope.actionType === 'RESTARTED') {
      return current !== null &&
        transportPeerId === current.controllerPeerId &&
        snapshot.sessionId === current.sessionId &&
        snapshot.revision === current.revision + 1
    }
    if (envelope.actionType === 'SESSION_STARTED') {
      // Story switch only (fresh starts are START_COMMITTED, 09).
      return current !== null &&
        transportPeerId === current.controllerPeerId &&
        snapshot.sessionEpoch === current.sessionEpoch + 1 &&
        snapshot.revision === 0
    }
    return false
  }

  // ---------- election ordering (rounds themselves in 10) ----------

  electController(peerIds: string[]): string {
    const unique = [...new Set(peerIds)].sort((a, b) => a.localeCompare(b))
    if (!unique[0]) throw new Error('Cannot elect a controller without peers')
    return unique[0]
  }

  // (sessionEpoch, revision) ordering: a stale pre-switch session with a huge
  // revision can never beat any current-epoch state.
  chooseElectionState(states: VisualNovelSessionState[]): VisualNovelSessionState {
    const candidates = [...states].sort((a, b) =>
      b.sessionEpoch - a.sessionEpoch ||
      b.revision - a.revision ||
      a.controllerPeerId.localeCompare(b.controllerPeerId)
    )
    if (!candidates[0]) throw new Error('No election state available')
    return candidates[0]
  }
}
```

## Tests for this step

Full matrices in 16; the gate/ordering-specific cases:

- **Gate:** a delayed `SESSION_STARTED`/`START_PROPOSE`/`RESTARTED` for a tombstoned session never reaches its handler — **including start actions whose outer scope is `"bootstrap"`** (the embedded candidate's session is what is checked); a `STATE_REQUEST` for a tombstoned session *does* pass and is answered with the retained end notice (11).
- **Decided-epoch semantics:** with `latestEpoch = 1`, a delayed epoch-1 `START_PROPOSE`/`START_COMMITTED` is dropped (`≤`), while an epoch-1 snapshot or announcement still passes (`<`) — the exact Revision 5 counterexample, both directions.
- **Meta persistence:** construct the service from `RoomMeta{highWaterEpoch: 5, endedSessions: [S5]}` after a simulated reload — a fresh start receives epoch 6, an old S5 snapshot is stale, and S5's `START_PROPOSE` resurrection is dropped; `noteEpoch`/`tombstone` invoke `onMetaChange` with the updated record.
- **Epoch staleness:** an `ELECTION_ADVERTISE` or snapshot embedding epoch `n − 1` is dropped once `latestEpoch === n`, regardless of its revision.
- **Ordering:** `chooseElectionState([S1@epoch1rev20, S2@epoch2rev0])` picks S2; `authorizeSnapshot` rejects a cross-session snapshot whose epoch is below current, even from the controller; `SESSION_STARTED` switch requires exactly `epoch + 1` and revision 0.
- Progression, request, and solicited-snapshot cases carry over from Revision 4 (16).
