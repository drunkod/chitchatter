# 08 — Sync service: authorization matrix and election rounds

> **Revision 4 changes:**
>
> 1. **Election rounds.** `CONTROLLER_CHANGED` is authorized against an explicit round object keyed by the **departed** controller, carries the **full adopted snapshot**, and is applied atomically. This fixes both Revision 3 defects: a replica can no longer accept a bare controller/revision jump while keeping stale scene/variables, and supersession now works after the first application (the old check "reject if `state.controllerPeerId` is connected" started failing the moment the first announcement installed a connected controller — round-scoped comparison replaces it).
> 2. **Start arbitration.** The revision-0 collision rule is replaced by a bounded arbitration phase with the total order `(controllerPeerId, sessionId)` (the second key also resolves duplicate starts by the same controller). The old rule split the room whenever one starter advanced before the competing start arrived.
> 3. **Session tombstones.** `SESSION_ENDED` requires exactly `current.revision + 1` and tombstones the session, so a delayed old end event cannot clear a newer restarted session, and late events for ended sessions are ignored.
> 4. Provenance caveats from the threat model (00) are stated inline where they apply.

`inspect*`/`authorize*` methods are pure (no seen-set mutation); `commit(envelope)` records an action ID only after successful application/handling.

## Authorization matrix

`sender` always means the transport-verified `context.peerId` (already cross-checked against `senderPeerId`). Structural + semantic validation (03/04) have already passed. **Row order:** tombstone check → duplicate check → row rule.

| Action | Authorized sender | Preconditions | Effect |
| --- | --- | --- | --- |
| `STATE_REQUEST` | any peer | handled only if self is controller; exempt from session match (bootstrap scope) | targeted `STATE_SNAPSHOT` echoing `requestActionId` |
| `ADVANCE_REQUEST` / `CHOICE_REQUEST` / `RESTART_REQUEST` | any peer | self is controller; session/story match; `expectedRevision === revision` (else snapshot reply) | one engine transition + canonical broadcast |
| `CONTROL_REQUEST` | any peer | M3: controller decides; until implemented: reject, no commit | `CONTROL_PASSED` |
| `STATE_SNAPSHOT` | current controller; **or** any peer iff it echoes our outstanding `requestActionId` *(crash-fault concession — see 00)* | same session: `state.revision >= current.revision`; cross-session: controller only; null state: solicited only | replace replica (atomic) |
| `SESSION_STARTED` | null/rev-0 local state: any peer, **into the arbitration phase**; existing progressed state: current controller only (story switch) | validator enforced rev 0 + controller == sender | candidate for arbitration / adopt switch |
| `RESTARTED` | current controller only | same session; `revision === current.revision + 1` | replace replica |
| `ADVANCED` / `CHOICE_RESOLVED` | current controller only | same session/story; `revision === current.revision + 1`; **engine replay matches** | apply derived state |
| `SESSION_ENDED` | current controller only | same session; **`revision === current.revision + 1`** | tombstone session; clear replica + checkpoint; lobby |
| `CONTROLLER_CHANGED` | locally computed winner only | open (or openable) election round for `payload.departedControllerPeerId`; departed controller absent; adopted `state.revision >= current.revision`; round-scoped supersession | **apply adopted snapshot + controller atomically** |
| `CONTROL_PASSED` | current controller only | `revision === current.revision + 1` (M3) | set controller |
| `ELECTION_ADVERTISE` | any remaining peer, targeted *(crash-fault concession — see 00)* | self is the computed winner; round open; state semantically valid | candidate for `chooseElectionState` |
| `ERROR` | any peer | never mutates session state | surface to UI |
| anything else / future | — | — | **reject; do not commit** |

## `src/services/visualNovel/VisualNovelSyncService.ts`

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

export interface ElectionRound {
  departedControllerPeerId: string
  openedAt: number
  // Advertised states collected at the winner.
  advertised: VisualNovelSessionState[]
  // Last announcement applied by this replica, for round-scoped supersession.
  applied: { revision: number; controllerPeerId: string } | null
}

const maxTombstones = 64

export class VisualNovelSyncService {
  private readonly seen = new Map<string, number>()
  private readonly endedSessions = new Map<string, number>() // sessionId → endedAt

  // ---------- tombstones ----------

  isTombstoned = (sessionId: string) => this.endedSessions.has(sessionId)

  tombstone(sessionId: string, endedAt: number) {
    this.endedSessions.set(sessionId, endedAt)
    while (this.endedSessions.size > maxTombstones) {
      const oldest = this.endedSessions.keys().next().value
      if (!oldest) break
      this.endedSessions.delete(oldest)
    }
  }

  // ---------- duplicate tracking (commit-after-apply) ----------

  isDuplicate = (actionId: string) => this.seen.has(actionId)

  commit(envelope: VisualNovelActionEnvelope) {
    this.seen.set(envelope.actionId, envelope.timestamp)
    while (this.seen.size > visualNovelLimits.maxSeenActionIds) {
      const oldest = this.seen.keys().next().value
      if (!oldest) break
      this.seen.delete(oldest)
    }
  }

  // ---------- progression (ADVANCED / CHOICE_RESOLVED / RESTARTED / CONTROL_PASSED) ----------

  inspectProgression(
    envelope: VisualNovelActionEnvelope,
    state: VisualNovelSessionState | null,
    transportPeerId: string
  ): CanonicalDecision {
    if (this.isTombstoned(envelope.sessionId)) return { kind: 'ignore', reason: 'tombstoned' }
    if (envelope.senderPeerId !== transportPeerId) return { kind: 'reject', reason: 'sender-mismatch' }
    if (this.isDuplicate(envelope.actionId)) return { kind: 'ignore', reason: 'duplicate' }
    if (!state) return { kind: 'recover', reason: 'missing-state' }
    if (transportPeerId !== state.controllerPeerId) return { kind: 'reject', reason: 'not-controller' }
    if (envelope.storyId !== state.storyId ||
        envelope.storyVersion !== state.storyVersion) {
      return { kind: 'reject', reason: 'story-mismatch' }
    }
    if (envelope.sessionId !== state.sessionId) return { kind: 'recover', reason: 'session-mismatch' }
    if (envelope.revision <= state.revision) return { kind: 'ignore', reason: 'stale' }
    if (envelope.revision !== state.revision + 1) return { kind: 'recover', reason: 'revision-gap' }
    return { kind: 'apply' }
  }

  // SESSION_ENDED shares progression rules (controller-only, exact next
  // revision) — dispatch reuses inspectProgression, then tombstones.

  // ---------- requests (controller side) ----------

  inspectRequest(
    envelope: VisualNovelActionEnvelope,
    state: VisualNovelSessionState,
    transportPeerId: string,
    selfPeerId: string
  ): CanonicalDecision {
    if (this.isTombstoned(envelope.sessionId) &&
        envelope.actionType !== 'STATE_REQUEST') {
      return { kind: 'ignore', reason: 'tombstoned' }
    }
    if (envelope.senderPeerId !== transportPeerId) return { kind: 'reject', reason: 'sender-mismatch' }
    if (state.controllerPeerId !== selfPeerId) return { kind: 'reject', reason: 'not-controller' }
    if (envelope.actionType !== 'STATE_REQUEST' &&
        (envelope.storyId !== state.storyId ||
         envelope.storyVersion !== state.storyVersion ||
         envelope.sessionId !== state.sessionId)) {
      return { kind: 'reject', reason: 'session-mismatch' }
    }
    if (this.isDuplicate(envelope.actionId)) return { kind: 'ignore', reason: 'duplicate' }
    return { kind: 'apply' }
  }

  // ---------- snapshots ----------

  // Provenance caveat (00): solicited acceptance trusts the responder under
  // the crash-fault model. The post-MVP hardening adds controller signatures.
  authorizeSnapshot(
    envelope: VisualNovelActionEnvelope,
    snapshot: VisualNovelSessionState,
    current: VisualNovelSessionState | null,
    transportPeerId: string,
    outstandingRequestId: string | null
  ): boolean {
    if (this.isTombstoned(snapshot.sessionId)) return false
    if (envelope.actionType === 'STATE_SNAPSHOT') {
      const solicited = outstandingRequestId !== null &&
        (envelope.payload as { requestActionId?: string }).requestActionId ===
          outstandingRequestId
      if (!current) return solicited
      const fromController = transportPeerId === current.controllerPeerId
      if (snapshot.sessionId === current.sessionId) {
        return (fromController || solicited) && snapshot.revision >= current.revision
      }
      return fromController
    }
    if (envelope.actionType === 'RESTARTED') {
      return current !== null &&
        transportPeerId === current.controllerPeerId &&
        snapshot.sessionId === current.sessionId &&
        snapshot.revision === current.revision + 1
    }
    if (envelope.actionType === 'SESSION_STARTED') {
      // Arbitration-phase candidates are collected by the dispatcher (09);
      // this method authorizes only the story-switch case.
      return current !== null && current.revision > 0 &&
        transportPeerId === current.controllerPeerId
    }
    return false
  }

  // ---------- start arbitration ----------

  // Total order over revision-0 candidates. The sessionId tie-break also
  // resolves duplicate starts from the same controller.
  chooseStartCandidate(
    candidates: VisualNovelSessionState[]
  ): VisualNovelSessionState {
    const sorted = [...candidates].sort((a, b) =>
      a.controllerPeerId.localeCompare(b.controllerPeerId) ||
      a.sessionId.localeCompare(b.sessionId)
    )
    if (!sorted[0]) throw new Error('No start candidate')
    return sorted[0]
  }

  // ---------- election ----------

  electController(peerIds: string[]): string {
    const unique = [...new Set(peerIds)].sort((a, b) => a.localeCompare(b))
    if (!unique[0]) throw new Error('Cannot elect a controller without peers')
    return unique[0]
  }

  chooseElectionState(states: VisualNovelSessionState[]): VisualNovelSessionState {
    const candidates = [...states].sort((a, b) =>
      b.revision - a.revision || a.controllerPeerId.localeCompare(b.controllerPeerId)
    )
    if (!candidates[0]) throw new Error('No election state available')
    return candidates[0]
  }

  // CONTROLLER_CHANGED acceptance, round-scoped. `round` is the replica's
  // open election round or null; `now` from injected clock.
  authorizeControllerChange(
    envelope: VisualNovelActionEnvelope,
    current: VisualNovelSessionState,
    transportPeerId: string,
    selfPeerId: string,
    connectedTransportPeerIds: string[],
    round: ElectionRound | null,
    now: number
  ): { ok: true } | { ok: false; reason: string } {
    const payload = envelope.payload as {
      departedControllerPeerId: string
      controllerPeerId: string
      state: VisualNovelSessionState
    }
    // Validator (03) already guaranteed: controllerPeerId === state.controllerPeerId
    // === senderPeerId, and envelope/state field consistency.
    if (payload.controllerPeerId !== transportPeerId) {
      return { ok: false, reason: 'sender-mismatch' }
    }
    // Round key must be THIS replica's departed controller. The connectivity
    // check applies to the departed peer, not the announced one — this is
    // what makes post-application supersession possible.
    const openRound = round && now - round.openedAt <= visualNovelLimits.electionRoundMs
      ? round
      : null
    const departedMatches = openRound
      ? payload.departedControllerPeerId === openRound.departedControllerPeerId
      : payload.departedControllerPeerId === current.controllerPeerId
    if (!departedMatches) return { ok: false, reason: 'wrong-round' }
    if (connectedTransportPeerIds.includes(payload.departedControllerPeerId)) {
      return { ok: false, reason: 'departed-still-connected' }
    }
    const expectedWinner = this.electController([selfPeerId, ...connectedTransportPeerIds])
    if (payload.controllerPeerId !== expectedWinner) {
      return { ok: false, reason: 'not-elected-winner' }
    }
    if (payload.state.revision < current.revision) {
      return { ok: false, reason: 'adopted-state-regresses' }
    }
    if (openRound?.applied) {
      const better =
        payload.state.revision > openRound.applied.revision ||
        (payload.state.revision === openRound.applied.revision &&
          payload.controllerPeerId < openRound.applied.controllerPeerId)
      if (!better) return { ok: false, reason: 'superseded' }
    }
    return { ok: true }
  }
}
```

## Why the round object fixes Revision 3

- **Content transfer:** the announcement *is* a snapshot. Applying it atomically replaces scene, variables, history, revision, and controller together. A replica behind by any number of revisions converges in one step — no fake-revision/stale-content divergence, and no snapshot round-trip needed on the happy path.
- **Supersession:** comparisons are made against `round.applied` for the round keyed by the departed controller, for `electionRoundMs` after opening. The first applied announcement no longer terminates the round: a later announcement with higher adopted revision (or equal revision and lower winner ID) still passes, because the "is the departed controller absent" check names the round's departed peer — not whoever is currently installed as controller.
- **Missed leave events:** a replica that never saw the departure can still authorize: when no round is open, the payload's `departedControllerPeerId` must equal the replica's recorded controller and that peer must be absent from the transport — which implicitly opens the round.
- **Gap-free:** since the full state travels, the old "replica one revision behind treats the announcement as a gap and asks the departed controller" deadlock is structurally impossible.

## Tests for this step

See 13 for the complete matrix; the round-specific cases are:

- announcement from a non-winner rejected (`not-elected-winner`), including self-nomination;
- announcement rejected while the departed controller is still connected;
- announcement whose adopted state regresses below the replica's revision rejected;
- **post-application supersession**: apply winner B at revision 6, then within the round accept winner A at revision 6 (A < B), and reject a further B re-announcement (`superseded`);
- announcement for a stale round (`departedControllerPeerId` ≠ recorded controller, no open round) rejected;
- replica that missed the leave event still converges (implicit round opening);
- `SESSION_ENDED` at `current.revision + 5` rejected; at `+1` applied and tombstoned; a subsequent `RESTARTED` for the tombstoned session ignored;
- start arbitration total order: `(controllerPeerId, sessionId)` picks one winner for duplicate starts from the same controller and for A/B collisions regardless of arrival order.
