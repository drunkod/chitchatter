# 08 — Sync service: pre-dispatch gate and authorization matrix

> **Revision 5 changes:** the tombstone/duplicate/epoch checks the Revision 4 matrix *promised* on every row now exist as **one pre-dispatch gate** the dispatcher (12) runs before any handler — previously the fresh-start path skipped them entirely, so a delayed `SESSION_STARTED` could resurrect an ended session and a retransmitted start could reopen arbitration. All cross-session ordering is by **`(sessionEpoch, revision)`**; `chooseElectionState` and controller-change adoption can no longer prefer a stale pre-switch session with a big revision number. Fresh starts moved to the coordinated round (09); elections freeze their electorate (10); termination rules are in 11.

`inspect*`/`authorize*` methods are pure; `commit(envelope)` records an action ID only after successful application/handling.

## Pre-dispatch gate (run once, in 12, before any handler)

```ts
// After structural validation + identity check, before dispatch:
if (sync.isTombstoned(envelope.sessionId)) {
  // Exception: a peer that missed the end may still REQUEST state for a
  // tombstoned session — answered with the persisted SESSION_ENDED (11).
  if (envelope.actionType !== 'STATE_REQUEST') return
}
if (sync.isDuplicate(envelope.actionId)) return
if (sync.isStaleEpoch(envelope)) return  // embedded state epoch < latestEpoch
```

`isStaleEpoch` inspects the embedded state of state-carrying actions (`START_*`, `SESSION_STARTED`, snapshots, `ELECTION_ADVERTISE`, `CONTROLLER_CHANGED`): anything strictly below the peer's `latestEpoch` is dead by definition — decided start rounds, retired sessions, and pre-switch stragglers all fall out here. Non-state-carrying actions pass (their session/revision rules follow).

Handlers therefore do **not** re-implement these checks; narrow exceptions are stated on the matrix row (only `STATE_REQUEST` has one).

## Authorization matrix

`sender` = transport-verified `context.peerId`. Structural (03) + semantic (04) validation and the gate have already passed.

| Action | Authorized sender | Preconditions | Effect |
| --- | --- | --- | --- |
| `START_PROPOSE` | any peer with null state | self is the start coordinator (09); candidate epoch = `latestEpoch + 1` | candidate collected for the round |
| `START_COMMITTED` | the start coordinator only (09) | round open at this peer *or* state null; epoch = `latestEpoch + 1` | **install fresh session** |
| `STATE_REQUEST` | any peer | handled if self is controller — or if the session is tombstoned, answered with the persisted `SESSION_ENDED` (11); exempt from session match (bootstrap scope) | targeted snapshot / end notice |
| `ADVANCE_REQUEST` / `CHOICE_REQUEST` / `RESTART_REQUEST` | any peer | self is controller; session/story match; `expectedRevision === revision` (else snapshot reply); **no pending termination** (11) | engine transition + canonical broadcast |
| `CONTROL_REQUEST` | any peer | M3; until implemented: reject, no commit | `CONTROL_PASSED` |
| `STATE_SNAPSHOT` | current controller; **or** any peer iff it echoes our outstanding `requestActionId` *(crash-fault concession, 00)* | same session: `(epoch, revision) ≥` current; cross-session: controller only, epoch ≥ current | replace replica (atomic) |
| `SESSION_STARTED` | current controller only (**story switch**, 09) | `state.sessionEpoch === current.sessionEpoch + 1`; revision 0; old session tombstoned on apply | adopt switched session |
| `RESTARTED` | current controller only | same session; `revision === current.revision + 1` | replace replica |
| `ADVANCED` / `CHOICE_RESOLVED` | current controller only | same session/story; `revision === current.revision + 1`; **engine replay matches** | apply derived state |
| `SESSION_ENDED` | current controller only | same session; `revision === current.revision + 1` | tombstone; clear replica + checkpoint; lobby (11) |
| `CONTROLLER_CHANGED` | **frozen winner of the round** (10) | `roundId`/electorate match the replica's frozen round (or implicit open); departed absent; adopted `(epoch, revision) ≥` current; round-scoped supersession | apply adopted snapshot + controller atomically |
| `CONTROL_PASSED` | current controller only | `revision === current.revision + 1` (M3) | set controller |
| `ELECTION_ADVERTISE` | electorate member, targeted *(crash-fault concession, 00)* | self is the frozen winner; `roundId` matches; state epoch = round epoch | candidate for adoption |
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
  private latestEpoch = 0 // highest epoch installed or tombstoned

  // ---------- gate primitives ----------

  isTombstoned = (sessionId: string) => this.endedSessions.has(sessionId)
  isDuplicate = (actionId: string) => this.seen.has(actionId)
  getLatestEpoch = () => this.latestEpoch

  noteEpoch(epoch: number) {
    if (epoch > this.latestEpoch) this.latestEpoch = epoch
  }

  isStaleEpoch(envelope: VisualNovelActionEnvelope): boolean {
    if (!stateCarrying.has(envelope.actionType)) return false
    const payload = envelope.payload as {
      state?: VisualNovelSessionState
      candidate?: VisualNovelSessionState
    }
    const embedded = payload.state ?? payload.candidate
    return embedded !== undefined && embedded.sessionEpoch < this.latestEpoch
  }

  tombstone(sessionId: string, epoch: number) {
    this.endedSessions.set(sessionId, epoch)
    this.noteEpoch(epoch)
    while (this.endedSessions.size > maxTombstones) {
      const oldest = this.endedSessions.keys().next().value
      if (!oldest) break
      this.endedSessions.delete(oldest)
    }
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

- **Gate:** a delayed `SESSION_STARTED`/`START_PROPOSE`/`RESTARTED` for a tombstoned session never reaches its handler; a retransmitted (already-committed) start proposal cannot reopen a round; a `STATE_REQUEST` for a tombstoned session *does* pass the gate and is answered with the persisted `SESSION_ENDED` (11).
- **Epoch staleness:** an `ELECTION_ADVERTISE` or snapshot embedding epoch `n − 1` is dropped by the gate once `latestEpoch === n`, regardless of its revision.
- **Ordering:** `chooseElectionState([S1@epoch1rev20, S2@epoch2rev0])` picks S2; `authorizeSnapshot` rejects a cross-session snapshot whose epoch is below current, even from the controller; `SESSION_STARTED` switch requires exactly `epoch + 1` and revision 0.
- Progression, request, and solicited-snapshot cases carry over from Revision 4 (16).
