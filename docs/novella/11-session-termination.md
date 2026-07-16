# 11 — Session termination and participation

> **Revision 6 changes:** termination is now a **round with acknowledgements**. Revision 5 finalized when the broadcast promise resolved — "send resolved" is not "everyone applied," so partial delivery could leave one population in the lobby and another playing on, with the finalized ex-controller stateless-but-connected and no election possible. The fix: a **frozen recipient set**, `SESSION_END_ACK` per recipient, finalization only when the set is exhausted (acked or departed), and the completed **end notice retained past finalization** inside the persistent tombstone (`RoomMeta`, 15) — resolving Revision 5's self-contradiction where `finalizeTermination` cleared the very envelope later text promised to replay to stale peers. Participation-ref rejoin fix carries over unchanged.

## Termination round (controller side)

```ts
// PendingTermination (02):
//   { sessionId, sessionEpoch, envelope, recipients: Set, acked: Set }
// envelope created ONCE at revision current + 1 — every resend carries the
// same actionId, so replicas that already applied treat resends as duplicates.

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
    recipients: new Set(transport.getPeers()), // FROZEN recipient set
    acked: new Set(),
  }
  // State NOT cleared; session NOT tombstoned locally; authority RETAINED.
  await disseminateTermination()
}

const disseminateTermination = async () => {
  const pending = pendingTerminationRef.current
  if (!pending) return
  const unacked = [...pending.recipients].filter(id => !pending.acked.has(id))
  if (unacked.length === 0) return finalizeTermination()
  try {
    await sendRef.current?.(pending.envelope, { target: unacked })
  } catch {
    surfaceSyncWarning('Ending the story has not reached everyone yet')
  }
  // Re-check after terminationAckTimeoutMs; acks and departures also
  // re-evaluate completion immediately (below).
  scheduleTerminationCycle()
}

// Receipt of SESSION_END_ACK (targeted; matrix row, 08):
const handleSessionEndAck = (envelope, context) => {
  const pending = pendingTerminationRef.current
  if (!pending) return // no round pending — ignore, do not commit
  if ((envelope.payload as { endActionId: string }).endActionId !==
      pending.envelope.actionId) return
  pending.acked.add(context.peerId)
  sync.commit(envelope)
  maybeFinalize()
}

// Transport departures shrink the frozen set — a peer that left no longer
// needs to ack (it will be caught by the retained notice if it returns):
const onPeerLeaveDuringTermination = (peerId: string) => {
  pendingTerminationRef.current?.recipients.delete(peerId)
  maybeFinalize()
}

const maybeFinalize = () => {
  const pending = pendingTerminationRef.current
  if (!pending) return
  const outstanding = [...pending.recipients].filter(id => !pending.acked.has(id))
  if (outstanding.length === 0) finalizeTermination()
}

const finalizeTermination = () => {
  const pending = pendingTerminationRef.current
  if (!pending) return
  pendingTerminationRef.current = null
  // The retained notice OUTLIVES finalization: it is stored inside the
  // persistent tombstone and replayed to stale/reconnecting peers.
  sync.tombstone(pending.sessionId, pending.sessionEpoch, pending.envelope) // (08)
  sync.commit(pending.envelope)
  setState(null)
  onSessionEnded(pending.sessionId) // clears checkpoint + latest pointer (15)
}
```

**Completion rule:** the round finalizes when every member of the frozen recipient set has acked **or left the transport**. This is the "all-current-members" rule — no quorum arithmetic, matching the room's cooperative model. It terminates under eventual stability (00): each remaining recipient eventually acks (targeted resends every `terminationAckTimeoutMs`) or departs.

### While termination is pending

- **Authority retained; state retained.** No election can start (the controller is present); no replica is stranded mid-session.
- **Progression refused:** advance/choice/restart requests for the ending session are answered with a **targeted resend of the pending end envelope** — each such request is another delivery attempt to exactly the peer that provably missed it.
- **`STATE_REQUEST` gets the end envelope**, not a snapshot of a dying session.
- **No start/switch:** `canStartStory` false; `switchSession` refused (13).
- **Controller crash mid-round:** replicas that applied the end are in the lobby with a persisted tombstone; replicas that missed it elect a winner (10) that inherits the live session and can run its own termination round. Transient split, self-resolving — consistent with the threat model's liveness scoping (00).

### Replica side

`SESSION_ENDED` reuses the progression rules (controller-only, same session, exactly `revision + 1` — 08). On apply: `sync.tombstone(sessionId, epoch, envelope)` (persisted, notice retained) → **send `SESSION_END_ACK { endActionId }` targeted at the sender** → `setState(null)` → `onSessionEnded(sessionId)` → commit. Resends are duplicates — but the ack is resent for a duplicate end envelope too, since a resend means the controller has not recorded our ack:

```ts
// In the pre-dispatch duplicate path (12), the ONE narrow duplicate
// exception: a duplicate SESSION_ENDED still triggers a (re-)ack.
if (sync.isDuplicate(envelope.actionId)) {
  if (envelope.actionType === 'SESSION_ENDED') void resendEndAck(envelope, context)
  return
}
```

### Stale and reconnecting peers

Any peer holding the persistent tombstone answers a `STATE_REQUEST` for the ended session — or same-session progression traffic from a peer that clearly missed the end — with the **retained end notice** (`sync.getRetainedEndNotice(sessionId)`, 08). Because the notice lives in `RoomMeta`, this works after finalization *and after a full reload of every peer* — the Revision 5 contradiction (cleared ref vs. promised replay) and the reload-amnesia hole (P1, epochs) are both closed by the same record.

## Participation — sync-owned ref

Unchanged from Revision 5: `participationRef` lives in the sync hook, is updated synchronously before any send (`leaveSession`, `rejoinSession`), and the receive-path guard reads the ref — never React state — so a snapshot delivered during the rejoin send is applied, and leave stays durable across incoming envelopes.

## Tests for this step

- **Ack round:** end with 3 recipients; deliver the envelope to only 2 — the round does not finalize; the third peer's `ADVANCE_REQUEST` receives the end envelope and its subsequent ack completes the round; only then is state cleared and the tombstone persisted.
- **"Send resolved" is not enough:** a transport whose broadcast promise resolves while delivering to a subset (16) must leave the round pending — the Revision 5 counterexample as a regression test.
- **Departure completes:** a never-acking recipient disconnects → removed from the frozen set → round finalizes.
- **Duplicate end re-acks:** a replica that already applied the end responds to a resent (duplicate) end envelope with a fresh ack; the controller's `acked` set converges.
- **Retained notice after finalization:** post-finalization (and post-reload, via `RoomMeta`), a stale peer's `STATE_REQUEST` receives the end notice, not silence — the ex-controller no longer "has neither state nor envelope."
- **Ack hygiene:** `SESSION_END_ACK` with the wrong `endActionId`, or arriving with no pending round, is ignored and not committed.
- Controller crash mid-round → live replicas elect and the new controller can finish termination; no start/switch during pending; delayed old end vs. restarted session (revision rule) and gate-drops for the tombstoned session carry over from Revision 5.
- **Rejoin race** (participation ref) carries over: synchronous snapshot during the rejoin send is applied; leave durable.
