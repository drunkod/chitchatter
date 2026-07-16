# 08 — Sync service, gate decisions, and authorization

> **Revision 7 changes:** replaces boolean pre-dispatch checks with a typed gate result, separates proposal and decision epoch rules, restores all persisted safety state, binds solicited snapshots to exact targets, and makes tombstoned-session replay explicit.

## Subject-state helpers

The session carried by bootstrap-scoped start actions is inside the payload:

```ts
subjectState(envelope: VisualNovelActionEnvelope): VisualNovelSessionState | null {
  switch (envelope.actionType) {
    case 'START_PROPOSE': return envelope.payload.candidate
    case 'START_COMMITTED': return envelope.payload.decision.state
    case 'START_DECISION_GOSSIP': return envelope.payload.knownState
    case 'SESSION_RECONCILE': return envelope.payload.state
    case 'STATE_SNAPSHOT':
    case 'SESSION_STARTED':
    case 'RESTARTED':
    case 'ELECTION_ADVERTISE':
    case 'CONTROLLER_CHANGED': return envelope.payload.state
    default: return null
  }
}

subjectSessionId(envelope: VisualNovelActionEnvelope): string {
  return this.subjectState(envelope)?.sessionId ?? envelope.sessionId
}
```

## Gate result

A boolean gate cannot express “drop but re-ack” or “do not dispatch; replay retained end.” Use:

```ts
export type GateDecision =
  | { kind: 'dispatch' }
  | { kind: 'drop'; reason: string }
  | { kind: 'reack-end' }
  | { kind: 'reply-ended'; notice: EnvelopeFor<'SESSION_ENDED'> }
```

```ts
inspectGate(envelope: VisualNovelActionEnvelope): GateDecision {
  // Duplicate SESSION_ENDED is handled before tombstone suppression so a lost
  // acknowledgement can recover.
  if (this.isDuplicate(envelope.actionId)) {
    return envelope.actionType === 'SESSION_ENDED'
      ? { kind: 'reack-end' }
      : { kind: 'drop', reason: 'duplicate' }
  }

  const embedded = this.subjectState(envelope)
  const sessionId = embedded?.sessionId ?? envelope.sessionId
  const retained = this.retainedEndNotices.get(sessionId)
  if (retained) {
    if (envelope.actionType === 'SESSION_ENDED' &&
        retained.actionId === envelope.actionId) {
      return { kind: 'reack-end' }
    }
    if (envelope.actionType === 'STATE_REQUEST' ||
        envelope.actionType === 'ADVANCE_REQUEST' ||
        envelope.actionType === 'CHOICE_REQUEST' ||
        envelope.actionType === 'RESTART_REQUEST') {
      return { kind: 'reply-ended', notice: retained }
    }
    return { kind: 'drop', reason: 'tombstoned' }
  }

  if (embedded) {
    if (envelope.actionType === 'START_PROPOSE' &&
        embedded.sessionEpoch <= this.latestEpoch) {
      return { kind: 'drop', reason: 'decided-epoch-proposal' }
    }
    if ((envelope.actionType === 'START_COMMITTED' ||
         envelope.actionType === 'START_DECISION_GOSSIP') &&
        embedded.sessionEpoch < this.latestEpoch) {
      return { kind: 'drop', reason: 'older-start-decision' }
    }
    if (!['START_PROPOSE', 'START_COMMITTED', 'START_DECISION_GOSSIP'].includes(
          envelope.actionType) && embedded.sessionEpoch < this.latestEpoch) {
      return { kind: 'drop', reason: 'stale-epoch' }
    }
  }

  return { kind: 'dispatch' }
}
```

Same-epoch start decisions and gossip reach the reconciliation handler. Only proposals use `<=`.

## Persistent initialization

```ts
constructor(
  meta: RoomMeta,
  private readonly persistMeta: (next: RoomMeta) => Promise<void>
) {
  this.latestEpoch = meta.highWaterEpoch
  for (const ended of meta.endedSessions) {
    this.endedSessions.set(ended.sessionId, ended.epoch)
    this.retainedEndNotices.set(ended.sessionId, ended.endEnvelope)
  }
  this.activeStartDecision = meta.activeStartDecision
}
```

Critical mutations are asynchronous and complete before exposing the resulting canonical state:

```ts
async noteEpoch(epoch: number, activeStartDecision = this.activeStartDecision) {
  if (epoch < this.latestEpoch) return
  const next = this.buildMeta({ highWaterEpoch: Math.max(epoch, this.latestEpoch), activeStartDecision })
  await this.persistMeta(next)
  this.installMeta(next)
}
```

If the write fails, the operation stays pending/read-only and the UI reports that local safety metadata could not be saved.

## Exact-target recovery

```ts
authorizeSolicitedSnapshot(
  snapshot: VisualNovelSessionState,
  contextPeerId: string,
  requestActionId: string | undefined,
  outstanding: OutstandingRecovery | null
): boolean {
  if (!outstanding || requestActionId !== outstanding.actionId) return false
  if (contextPeerId !== outstanding.targetPeerId) return false
  if (snapshot.sessionEpoch < outstanding.expectedEpoch) return false
  return true
}
```

This permits an explicitly requested cross-session reconciliation snapshot from the selected target without opening unsolicited cross-session snapshot acceptance.

## Authorization matrix

| Action | Sender and preconditions | Result |
| --- | --- | --- |
| `START_PROPOSE` | candidate controller = sender; local state null; self is current local coordinator; candidate epoch = highWater + 1 | collect |
| `START_COMMITTED` | sender = embedded coordinator; coordinator is current local coordinator or the coordinator targeted by our pending proposal | apply/reconcile decision |
| `START_DECISION_GOSSIP` | any honest holder; normalized embedded decision and known state; epoch not older | apply/reconcile under provenance concession |
| `SESSION_RECONCILE` | any honest peer during a recorded same-epoch conflict; incoming state wins total comparator | replace atomically |
| `STATE_REQUEST` | any peer | controller snapshot, exact recovery response, held decision, or retained end |
| `STATE_SNAPSHOT` | current controller, or exact outstanding target echoing request ID | apply if comparator/recovery rules allow |
| request actions | self is controller; exact session/story/revision; no termination | serialize engine transition |
| progression events | sender is current controller; exact next revision; replay matches | apply |
| `SESSION_STARTED` | current controller; epoch exactly +1; revision 0 | tombstone old, switch |
| `SESSION_ENDED` | current controller; exact next revision | persist tombstone, ack, clear |
| `SESSION_END_ACK` | sender is frozen recipient; exact pending end action ID | mark acked |
| `ELECTION_ADVERTISE` | local electorate member to local winner; local round/epoch match | collect |
| `CONTROLLER_CHANGED` | sender is min of canonical advertised electorate; migration record matches original departure; state wins supersession comparator | replace atomically |
| unimplemented control actions | none | reject without commit |

## Session comparator

`compareSessionPriority` from 01 is used by start gossip, `SESSION_RECONCILE`, and migration supersession. Do not implement slightly different orderings in each handler.
