# 02 — Data models and protocol records

> **Revision 7 changes:** adds identity-safe start-decision gossip, explicit reconciliation state, migration records that retain the original departure, exact-target recovery records, and complete persistent room metadata.

## Core session models

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

export type VisualNovelParticipation =
  | { kind: 'joined' }
  | { kind: 'left-current-session'; sessionId: string }
```

Story manifest, scene, dialogue, choice, condition, effect, and asset-reference types remain the normalized declarative types validated in 04.

## Actions

```ts
export type VisualNovelActionType =
  | 'START_PROPOSE'
  | 'START_COMMITTED'
  | 'START_DECISION_GOSSIP'
  | 'SESSION_RECONCILE'
  | 'STATE_REQUEST'
  | 'STATE_SNAPSHOT'
  | 'ADVANCE_REQUEST'
  | 'ADVANCED'
  | 'CHOICE_REQUEST'
  | 'CHOICE_RESOLVED'
  | 'SESSION_STARTED'
  | 'SESSION_ENDED'
  | 'SESSION_END_ACK'
  | 'ELECTION_ADVERTISE'
  | 'CONTROLLER_CHANGED'
  | 'CONTROL_REQUEST'
  | 'CONTROL_PASSED'
  | 'RESTART_REQUEST'
  | 'RESTARTED'
  | 'ERROR'
```

```ts
export interface VisualNovelActionEnvelope<T = any>
  extends Record<string, any> {
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

export type EnvelopeFor<T extends VisualNovelActionType> =
  VisualNovelActionEnvelope<VisualNovelPayloadByAction[T]> & { actionType: T }
```

## Start decision records

```ts
export interface StartDecisionRecord extends Record<string, any> {
  decisionId: string
  coordinatorPeerId: string
  originActionId: string
  state: VisualNovelSessionState // revision 0 decision state
}

export type VisualNovelPayloadByAction = {
  START_PROPOSE: {
    proposalId: string
    candidate: VisualNovelSessionState
  }
  START_COMMITTED: {
    decision: StartDecisionRecord
  }
  // Outer sender is the honest holder. The embedded record preserves the
  // coordinator decision without pretending the holder is the coordinator.
  START_DECISION_GOSSIP: {
    decision: StartDecisionRecord
    knownState: VisualNovelSessionState
  }
  // Full-state deterministic reconciliation after a same-epoch conflict.
  SESSION_RECONCILE: {
    reason: 'start-conflict' | 'migration-conflict'
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

## Internal lifecycle records

```ts
export type RecoveryKind =
  | 'bootstrap'
  | 'revision-gap'
  | 'start-reconcile'
  | 'migration-reconcile'

export interface OutstandingRecovery {
  actionId: string
  targetPeerId: string
  expectedEpoch: number
  kind: RecoveryKind
  createdAt: number
}

export interface StartRound {
  coordinatorPeerId: string
  epoch: number
  proposals: VisualNovelSessionState[]
  openedAt: number
}

export interface MigrationRecord {
  sessionEpoch: number
  departedControllerPeerId: string
  openedAt: number
  closesAt: number
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

## Persistent room metadata

```ts
export interface PersistedEndNotice {
  sessionId: string
  epoch: number
  endEnvelope: EnvelopeFor<'SESSION_ENDED'>
}

export interface RoomMeta {
  version: 1
  highWaterEpoch: number
  endedSessions: PersistedEndNotice[]
  // Retains a recoverable decision across reloads. It is removed when the
  // epoch is ended or replaced by a higher epoch.
  activeStartDecision: StartDecisionRecord | null
}
```

`RoomMeta` is normalized and validated before constructing the sync service. It is not populated by casting storage data.
