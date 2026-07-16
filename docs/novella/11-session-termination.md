# 11 — Session termination and participation

> **New step in Revision 5.** The generic send-failure rule (apply locally → retry → snapshot repair) cannot repair `SESSION_ENDED`: ending clears the very state a repair snapshot would need, other peers continue the session, and the former controller remains connected — so no transport departure ever triggers an election. The fix is a **pending-termination record**: the controller keeps state and authority until the end envelope has disseminated, answering interim requests with the same persisted end envelope. Participant leave/rejoin moves into a **sync-owned mutable ref** so a snapshot arriving during the rejoin send cannot be discarded by a stale React closure.

## Termination protocol (controller side)

```ts
// PendingTermination (02): { sessionId, sessionEpoch, envelope }
// where envelope is EnvelopeFor<'SESSION_ENDED'> at revision current + 1,
// created ONCE — retries resend the same actionId so replicas that already
// applied it treat resends as duplicates.

const endSession = async () => {
  const current = stateRef.current
  if (!current || current.controllerPeerId !== selfId) return
  if (pendingTerminationRef.current) return // already ending

  const envelope = createVisualNovelEnvelope(
    'SESSION_ENDED', {}, current, selfId, current.revision + 1, dependencies)
  pendingTerminationRef.current = {
    sessionId: current.sessionId,
    sessionEpoch: current.sessionEpoch,
    envelope,
  }
  // NOTE: state is NOT cleared, the session is NOT tombstoned locally, and
  // controller authority is retained until the send succeeds.
  await disseminateTermination()
}

const disseminateTermination = async () => {
  const pending = pendingTerminationRef.current
  if (!pending) return
  try {
    await sendRef.current?.(pending.envelope) // broadcast
    finalizeTermination()                     // only on success
  } catch {
    surfaceSyncWarning('Ending the story has not reached everyone yet')
    scheduleTerminationRetry() // backoff retry; also retried from handleRequest
  }
}

const finalizeTermination = () => {
  const pending = pendingTerminationRef.current
  if (!pending) return
  pendingTerminationRef.current = null
  sync.tombstone(pending.sessionId, pending.sessionEpoch)
  sync.commit(pending.envelope)
  setState(null)
  onSessionEnded(pending.sessionId) // clears checkpoint + latest pointer (15)
}
```

### While termination is pending

- **Authority is retained.** The controller still owns the session; it has not vanished, so no election can start, and no replica is stranded mid-session.
- **Progression is refused.** `handleRequest` answers `ADVANCE_REQUEST` / `CHOICE_REQUEST` / `RESTART_REQUEST` for the ending session with a **targeted resend of the pending end envelope** (same `actionId`), not with a transition — the matrix row "no pending termination" (08). This doubles as a per-request retry channel: every request from a peer that has not yet seen the end gives the controller another delivery attempt.
- **`STATE_REQUEST` gets the end envelope too**, so late joiners learn the session is over instead of receiving a snapshot of a dying session.
- **The controller may not start or switch** while a termination is pending (`canStartStory` is false, 13).
- If the controller itself disconnects while pending, remaining replicas that already applied the end are in the lobby; replicas that did not will open an election round (10), and the elected winner inherits a live session — acceptable under the crash-fault model, and the winner's own `endSession` can finish the job.

### Replica side

`SESSION_ENDED` reuses the progression rules (controller-only, same session, exactly `revision + 1` — 08). On apply: `sync.tombstone(sessionId, epoch)` → `setState(null)` → `onSessionEnded(sessionId)` → `commit`. A delayed old end for a restarted session fails the revision rule; late traffic for the ended session dies at the pre-dispatch gate; resends are duplicates.

### Answering `STATE_REQUEST` for a tombstoned session

The gate's single exception (08): a `STATE_REQUEST` whose scope is a tombstoned session (or from a peer whose bootstrap arrives after the end) is answered by **any peer that has the persisted end envelope** — in practice the former controller keeps `PendingTermination.envelope` around until finalized, and replicas simply don't answer (the requester's own gate will drop stale session traffic, and its lobby state is correct once no controller responds with a snapshot).

## Participation — sync-owned ref

The Revision 4 rejoin flow (`setParticipation(...); await sync.rejoinSession()`) raced React's render commit: the receive callback could still close over `left-current-session` while the rejoin snapshot arrived, discarding it. Participation is now a **mutable ref owned by the sync hook**, updated synchronously before any send; React state only mirrors it for rendering.

```ts
// Inside useVisualNovelSync:
const participationRef = useRef<VisualNovelParticipation>({ kind: 'joined' })

const leaveSession = () => {
  const current = stateRef.current
  if (!current) return
  participationRef.current = {
    kind: 'left-current-session', sessionId: current.sessionId,
  }
  onParticipationChange(participationRef.current) // mirrors to React state
}

const rejoinSession = async () => {
  participationRef.current = { kind: 'joined' } // SYNCHRONOUS — before send
  onParticipationChange(participationRef.current)
  await requestBootstrapSnapshot() // records outstandingRequestIdRef
}

// In the receive path (12), the guard reads the REF, never React state:
if (participationRef.current.kind === 'left-current-session' &&
    envelope.sessionId === participationRef.current.sessionId) {
  return
}
```

A snapshot delivered synchronously during the `rejoinSession` send now sees `joined` and is applied. Leave remains durable: the ref survives every incoming envelope, and only an explicit `rejoinSession` (or a *new* session installed via `START_COMMITTED`/switch — leaving applies per session) resets it.

## Tests for this step

- **End-send failure:** make the broadcast reject — the controller retains state and authority; a participant's `ADVANCE_REQUEST` receives the end envelope (not a transition, not a snapshot); once a resend succeeds, everyone reaches the lobby and the controller finalizes (tombstone, cleared state + checkpoint).
- The end envelope is created once: resends carry the same `actionId`; replicas that applied it ignore resends as duplicates.
- No election triggers while the ending controller stays connected; if it disconnects mid-pending, replicas that missed the end elect a winner that can still end the session.
- `canStartStory` is false during pending termination; `switchSession` refused.
- Delayed old `SESSION_ENDED` cannot clear a restarted session (revision rule); late `RESTARTED`/`SESSION_STARTED` for the tombstoned session are gate-dropped; a late-joiner `STATE_REQUEST` after the end receives the end notice, not a snapshot.
- **Rejoin race:** with a synchronous test transport, deliver the bootstrap snapshot during the `rejoinSession` send — it must be applied (ref updated before send). Leave stays durable across incoming progression, snapshots, and announcements for the left session.
