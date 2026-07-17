# 02 — Data models and durable protocol records

> **Revision 9 changes:** separates retirement from completed-end certificates, binds original end epoch/story, adds the durable current-epoch outcome, and makes migration explicitly session-bound.

## Core state and envelope

```ts
export type VisualNovelValue = string | number | boolean

export interface VisualNovelHistoryEntry {
  revision: number
  sceneId: string
  dialogueEntryId: string
  choiceId?: string
}

export interface VisualNovelSessionState extends Record<string, unknown> {
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

export type VisualNovelParticipation =
  | { kind: 'joined' }
  | { kind: 'left-current-session'; sessionId: string }

export interface VisualNovelActionEnvelope<T = unknown> extends Record<string, unknown> {
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

## Actions

```ts
export type VisualNovelActionType =
  | 'START_PROPOSE' | 'START_COMMITTED' | 'START_DECISION_GOSSIP'
  | 'SESSION_RECONCILE'
  | 'STATE_REQUEST' | 'STATE_SNAPSHOT'
  | 'ADVANCE_REQUEST' | 'ADVANCED'
  | 'CHOICE_REQUEST' | 'CHOICE_RESOLVED'
  | 'SESSION_STARTED'
  | 'SESSION_ENDED' | 'SESSION_END_ACK' | 'SESSION_END_NOTICE_GOSSIP'
  | 'ELECTION_ADVERTISE' | 'CONTROLLER_CHANGED'
  | 'CONTROL_REQUEST' | 'CONTROL_PASSED'
  | 'RESTART_REQUEST' | 'RESTARTED' | 'ERROR'
```

```ts
export interface StartDecisionRecord extends Record<string, unknown> {
  decisionId: string
  coordinatorPeerId: string
  originActionId: string
  state: VisualNovelSessionState // revision 0
}

export interface SessionRetirement extends Record<string, unknown> {
  sessionId: string
  sessionEpoch: number
  storyId: string
  storyVersion: string
  reason: 'ended' | 'switched' | 'reconciled'
}

export interface CompletedEndCertificate extends Record<string, unknown> {
  sessionId: string
  sessionEpoch: number
  storyId: string
  storyVersion: string
  endEnvelope: EnvelopeFor<'SESSION_ENDED'>
}

export interface EpochOutcome extends Record<string, unknown> {
  epoch: number
  canonicalSessionId: string
  status: 'active' | 'ended'
}
```

```ts
export type EnvelopeFor<T extends VisualNovelActionType> =
  VisualNovelActionEnvelope<VisualNovelPayloadByAction[T]> & { actionType: T }

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
    decision?: StartDecisionRecord
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

  SESSION_ENDED: { sessionEpoch: number }
  SESSION_END_ACK: { endActionId: string }
  SESSION_END_NOTICE_GOSSIP: { certificate: CompletedEndCertificate }

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
  migrationId: string | null
  createdAt: number
  expiresAt: number
}

export interface StartConflict {
  conflictId: string
  epoch: number
  localState: VisualNovelSessionState
  remoteState: VisualNovelSessionState
  localDecision: StartDecisionRecord | null
  remoteDecision: StartDecisionRecord | null
}

export interface PendingTermination {
  sessionId: string
  sessionEpoch: number
  envelope: EnvelopeFor<'SESSION_ENDED'>
  recipients: Set<string>
  acked: Set<string>
}

export interface MigrationRecord extends Record<string, unknown> {
  migrationId: string
  sessionEpoch: number
  sessionId: string
  departedControllerPeerId: string
  lastAppliedState: VisualNovelSessionState | null
}
```

## Persistent RoomMeta

```ts
export interface RoomMeta {
  version: 1
  generation: number
  highWaterEpoch: number
  epochOutcome: EpochOutcome | null
  retiredSessions: SessionRetirement[]
  completedEndCertificates: CompletedEndCertificate[]
  activeStartDecision: StartDecisionRecord | null
  activeMigration: MigrationRecord | null
}
```

Cross-field invariants:

- high water 0 iff outcome/active records are null;
- otherwise outcome epoch equals high water;
- `ended` outcome has no active decision or migration;
- active decision epoch/session equals active outcome;
- active migration epoch/session equals active outcome and its last state;
- retired records and certificates are unique/canonically sorted;
- every certificate has a matching `ended` retirement;
- certificate fields exactly match the embedded original end envelope and payload epoch;
- active outcome session is not retired unless outcome is `ended`;
- start and migration records may coexist only for the same active session/epoch.
