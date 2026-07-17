# 02 — Data models and durable protocol records

> **Revision 8 changes:** adds identity-safe completed-end gossip, persists active migration authority, makes recovery requests conflict-specific, and gives RoomMeta a generation for serialized writes.

## Session and envelope

```ts
export type VisualNovelValue = string | number | boolean

export interface VisualNovelHistoryEntry {
  revision: number
  sceneId: string
  dialogueEntryId: string
  choiceId?: string
}

export interface VisualNovelSessionState extends Record<string, any> {
  protocolVersion: 1
  storyId: string
  storyVersion: string
  sessionId: string
  sessionEpoch: number
  sceneId: string
  dialogueEntryId: string
  variables: Record<string, VisualNovelValue>
  history: VisualNovelHistoryEntry[]
  controllerPeerId: string
  revision: number
  updatedAt: number
}

export interface VisualNovelActionEnvelope<T = any> extends Record<string, any> {
  protocol: 'visual-novel'
  protocolVersion: 1
  actionId: string
  actionType: VisualNovelActionType
  sessionId: string
  storyId: string
  storyVersion: string
  senderPeerId: string
  revision: number
  timestamp: number
  payload: T
  proof?: string
}
```

## Actions and payloads

```ts
export type VisualNovelActionType =
  | 'START_PROPOSE' | 'START_COMMITTED' | 'START_DECISION_GOSSIP'
  | 'SESSION_RECONCILE'
  | 'STATE_REQUEST' | 'STATE_SNAPSHOT'
  | 'ADVANCE_REQUEST' | 'ADVANCED'
  | 'CHOICE_REQUEST' | 'CHOICE_RESOLVED'
  | 'SESSION_STARTED' | 'SESSION_ENDED' | 'SESSION_END_ACK'
  | 'SESSION_END_NOTICE_GOSSIP'
  | 'ELECTION_ADVERTISE' | 'CONTROLLER_CHANGED'
  | 'CONTROL_REQUEST' | 'CONTROL_PASSED'
  | 'RESTART_REQUEST' | 'RESTARTED' | 'ERROR'

export interface StartDecisionRecord extends Record<string, any> {
  decisionId: string
  coordinatorPeerId: string
  originActionId: string
  state: VisualNovelSessionState // decision state at revision 0
}

export interface PersistedEndNotice extends Record<string, any> {
  sessionId: string
  epoch: number
  endEnvelope: EnvelopeFor<'SESSION_ENDED'>
}

export type VisualNovelPayloadByAction = {
  START_PROPOSE: { proposalId: string; candidate: VisualNovelSessionState }
  START_COMMITTED: { decision: StartDecisionRecord }
  START_DECISION_GOSSIP: {
    decision: StartDecisionRecord
    knownState: VisualNovelSessionState
  }
  SESSION_RECONCILE: {
    reason: 'start-conflict' | 'migration-conflict'
    conflictId: string
    state: VisualNovelSessionState
  }

  STATE_REQUEST: { knownRevision: number; recoveryKind: RecoveryKind }
  STATE_SNAPSHOT: { state: VisualNovelSessionState; requestActionId?: string }
  ADVANCE_REQUEST: { expectedRevision: number }
  ADVANCED: { sceneId: string; dialogueEntryId: string }
  CHOICE_REQUEST: { choiceId: string; expectedRevision: number }
  CHOICE_RESOLVED: {
    choiceId: string
    sceneId: string
    dialogueEntryId: string
    variables: Record<string, VisualNovelValue>
  }
  SESSION_STARTED: { state: VisualNovelSessionState }
  SESSION_ENDED: Record<string, never>
  SESSION_END_ACK: { endActionId: string }
  // New outer sender is the holder; the embedded original end envelope is the certificate.
  SESSION_END_NOTICE_GOSSIP: { ended: PersistedEndNotice }
  ELECTION_ADVERTISE: { roundId: string; state: VisualNovelSessionState }
  CONTROLLER_CHANGED: {
    roundId: string
    departedControllerPeerId: string
    electorate: string[]
    controllerPeerId: string
    state: VisualNovelSessionState
  }
  CONTROL_REQUEST: Record<string, never>
  CONTROL_PASSED: { controllerPeerId: string }
  RESTART_REQUEST: { expectedRevision: number }
  RESTARTED: { state: VisualNovelSessionState }
  ERROR: { code: string; requestActionId?: string }
}

export type EnvelopeFor<T extends VisualNovelActionType> =
  VisualNovelActionEnvelope<VisualNovelPayloadByAction[T]> & { actionType: T }
```

## Runtime records

```ts
export type RecoveryKind =
  | 'bootstrap' | 'revision-gap' | 'start-reconcile' | 'migration-reconcile'

export interface OutstandingRecovery {
  actionId: string
  targetPeerId: string
  expectedEpoch: number
  expectedSessionId: string | null
  kind: RecoveryKind
  conflictId: string | null
  createdAt: number
  expiresAt: number
}

export interface StartConflict {
  conflictId: string
  epoch: number
  localState: VisualNovelSessionState
  remoteState: VisualNovelSessionState
}

export interface MigrationRecord extends Record<string, any> {
  migrationId: string
  sessionEpoch: number
  sessionId: string
  departedControllerPeerId: string
  lastAppliedState: VisualNovelSessionState | null
}

export interface PendingTermination {
  sessionId: string
  sessionEpoch: number
  envelope: EnvelopeFor<'SESSION_ENDED'>
  recipients: Set<string>
  acked: Set<string>
}
```

## Persistent RoomMeta

```ts
export interface RoomMeta {
  version: 1
  generation: number
  highWaterEpoch: number
  endedSessions: PersistedEndNotice[]
  activeStartDecision: StartDecisionRecord | null
  activeMigration: MigrationRecord | null
}
```

Cross-field invariants:

- `highWaterEpoch >=` every tombstone epoch;
- active start decision epoch equals `highWaterEpoch` and is not tombstoned;
- active migration epoch equals `highWaterEpoch`, names the same session as its last applied state, and is not tombstoned;
- active start and migration may coexist only for the same session/epoch;
- tombstones are unique and canonically sorted by `(epoch, sessionId)`;
- retained original end envelope scope matches its persisted session and its revision is valid;
- higher epoch or exact-session end clears obsolete active records.

All records are normalized into fresh objects before use.
