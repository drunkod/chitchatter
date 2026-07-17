# 02 — Data models, transition certificates, supersession, and recovery

> **Revision 12 changes:** stores full epoch-transition provenance, adds generic supersession and safety-recovery actions, binds election advertisements to migration records, and generation-fences checkpoints.

## Core state

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

export interface ValidatedState {
  state: VisualNovelSessionState
  digest: string
  canonicalBytes: Uint8Array
}
```

## Envelope and actions

```ts
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

export type VisualNovelActionType =
  | 'START_PROPOSE' | 'START_COMMITTED' | 'START_DECISION_GOSSIP'
  | 'SESSION_RECONCILE'
  | 'STATE_REQUEST' | 'STATE_SNAPSHOT' | 'STATE_FLOOR_GOSSIP'
  | 'ADVANCE_REQUEST' | 'ADVANCED'
  | 'CHOICE_REQUEST' | 'CHOICE_RESOLVED'
  | 'SESSION_STARTED'
  | 'SESSION_ENDED' | 'SESSION_END_ACK' | 'SESSION_END_NOTICE_GOSSIP'
  | 'SESSION_RETIREMENT_GOSSIP' | 'SESSION_SUPERSESSION_GOSSIP'
  | 'SAFETY_RECOVERY_REQUEST' | 'SAFETY_RECOVERY_GOSSIP'
  | 'ELECTION_ADVERTISE' | 'CONTROLLER_CHANGED'
  | 'CONTROL_REQUEST' | 'CONTROL_PASSED'
  | 'RESTART_REQUEST' | 'RESTARTED' | 'ERROR'
```

## Origin and transition evidence

```ts
export interface StartDecisionRecord extends Record<string, unknown> {
  decisionId: string
  coordinatorPeerId: string
  originActionId: string
  state: VisualNovelSessionState // revision 0
}

export type SessionOriginEvidence =
  | { kind: 'start-decision'; decision: StartDecisionRecord }
  | { kind: 'epoch-transition'; transitionId: string }

export interface SessionSubject {
  sessionId: string
  sessionEpoch: number
  storyId: string
  storyVersion: string
}

export interface SessionStartedCertificate extends Record<string, unknown> {
  envelope: EnvelopeFor<'SESSION_STARTED'>
  predecessor: SessionSubject
  predecessorRevision: number
}

export interface EpochTransitionCertificate extends Record<string, unknown> {
  transitionId: string
  kind: 'initial-start' | 'start-after-ended' | 'switch'
  predecessorOutcome: EpochOutcome | null
  successorOutcome: EpochOutcome // active, revision-0 floor
  successorOrigin:
    | { kind: 'start-decision'; decision: StartDecisionRecord }
    | { kind: 'session-started'; certificate: SessionStartedCertificate }
}
```

`transitionId` is recomputed from the normalized raw certificate fields. `SESSION_STARTED` payload binds predecessor subject/revision and successor state so the action ID cannot be mixed with another state.

## Durable evidence

```ts
export interface SessionDisposition extends Record<string, unknown> {
  sessionId: string
  sessionEpoch: number
  storyId: string
  storyVersion: string
  reason: 'ended' | 'switched' | 'reconciled'
  evidenceId: string // end action ID, transition ID, or conflict ID
}

export interface CompletedEndCertificate extends Record<string, unknown> {
  sessionId: string
  sessionEpoch: number
  storyId: string
  storyVersion: string
  endEnvelope: EnvelopeFor<'SESSION_ENDED'>
}

export interface CanonicalStateFloor extends Record<string, unknown> {
  sessionId: string
  sessionEpoch: number
  storyId: string
  storyVersion: string
  controllerPeerId: string
  revision: number
  stateDigest: string
}

export interface EpochOutcome extends Record<string, unknown> {
  epoch: number
  canonicalSessionId: string
  status: 'active' | 'ended'
  floor: CanonicalStateFloor
}
```

## Supersession evidence

```ts
export interface SupersessionEvidence extends Record<string, unknown> {
  requestedSession: SessionSubject
  transitions: EpochTransitionCertificate[] // contiguous after requested epoch
  currentOutcome: EpochOutcome
  currentOrigin: SessionOriginEvidence | null
  currentKnownState: VisualNovelSessionState | null
  currentEndCertificate: CompletedEndCertificate | null
}
```

The chain’s final successor equals `currentOutcome`. Active outcome requires matching origin; ended outcome requires matching end certificate. Known state, when present, exactly matches the final floor.

## Conflicts and migration

```ts
export type ConflictKind = 'start' | 'migration'

export interface ConflictDescriptor extends Record<string, unknown> {
  kind: ConflictKind
  epoch: number
  sessionIdA: string
  sessionIdB: string
  migrationId: string | null
  lowerStateDigest: string
  higherStateDigest: string
  conflictId: string
}

export interface MigrationRecord extends Record<string, unknown> {
  migrationId: string
  sessionEpoch: number
  sessionId: string
  departedControllerPeerId: string
  openedAtRevision: number
  lastAppliedState: VisualNovelSessionState | null
}

export interface MigrationLineage extends Record<string, unknown> {
  sessionEpoch: number
  sessionId: string
  records: MigrationRecord[]
}
```

## Payload map

```ts
export type EnvelopeFor<T extends VisualNovelActionType> =
  VisualNovelActionEnvelope<VisualNovelPayloadByAction[T]> & { actionType: T }

export type VisualNovelPayloadByAction = {
  START_PROPOSE: { proposalId: string; candidate: VisualNovelSessionState }
  START_COMMITTED: { decision: StartDecisionRecord }
  START_DECISION_GOSSIP: { decision: StartDecisionRecord; knownState: VisualNovelSessionState }
  SESSION_RECONCILE: {
    descriptor: ConflictDescriptor
    state: VisualNovelSessionState
    origin?: SessionOriginEvidence
  }

  STATE_REQUEST: { knownRevision: number; recoveryKind: RecoveryKind }
  STATE_SNAPSHOT: { state: VisualNovelSessionState; requestActionId?: string }
  STATE_FLOOR_GOSSIP: {
    outcome: EpochOutcome
    origin: SessionOriginEvidence | null
    requestActionId?: string
    recoveryTargets: string[]
  }

  ADVANCE_REQUEST: { expectedRevision: number }
  ADVANCED: { sceneId: string; dialogueEntryId: string }
  CHOICE_REQUEST: { choiceId: string; expectedRevision: number }
  CHOICE_RESOLVED: {
    choiceId: string
    sceneId: string
    dialogueEntryId: string
    variables: Record<string, VisualNovelValue>
  }

  SESSION_STARTED: {
    predecessor: SessionSubject
    predecessorRevision: number
    state: VisualNovelSessionState
  }
  SESSION_ENDED: { sessionEpoch: number }
  SESSION_END_ACK: { endActionId: string }
  SESSION_END_NOTICE_GOSSIP: { certificate: CompletedEndCertificate }
  SESSION_RETIREMENT_GOSSIP: { disposition: SessionDisposition }
  SESSION_SUPERSESSION_GOSSIP: { evidence: SupersessionEvidence }

  SAFETY_RECOVERY_REQUEST: { lockKind: 'capacity'; knownEpoch: number; knownGeneration: number }
  SAFETY_RECOVERY_GOSSIP: { evidence: SupersessionEvidence }

  ELECTION_ADVERTISE: {
    roundId: string
    migrationId: string
    departedControllerPeerId: string
    openedAtRevision: number
    state: VisualNovelSessionState
  }
  CONTROLLER_CHANGED: {
    roundId: string
    migrationId: string
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

## Runtime and persistence records

```ts
export type RecoveryKind =
  | 'bootstrap' | 'revision-gap' | 'start-reconcile'
  | 'migration-reconcile' | 'supersession' | 'safety-recovery'

export interface OutstandingRecovery {
  actionId: string
  targetPeerId: string
  expectedEpoch: number
  expectedSessionId: string | null
  expectedFloorDigest: string | null
  kind: RecoveryKind
  conflictId: string | null
  migrationId: string | null
  createdAt: number
  expiresAt: number
}

export interface DurableSafetyLock {
  kind: 'capacity' | 'digest-collision'
  code: string
  lockedAtEpoch: number
  lockedAtGeneration: number
}

export interface RuntimeSafetyState {
  kind: 'lock-unavailable' | 'storage-failure'
  code: string
}

export interface CheckpointRecord {
  sourceGeneration: number
  floorDigest: string
  state: VisualNovelSessionState
}

export interface LatestCheckpointPointer {
  sessionId: string
  sourceGeneration: number
  floorDigest: string
}

export interface RoomMeta {
  version: 1
  generation: number
  highWaterEpoch: number
  epochOutcome: EpochOutcome | null
  epochTransitions: EpochTransitionCertificate[]
  dispositions: SessionDisposition[]
  completedEndCertificates: CompletedEndCertificate[]
  activeOrigin: SessionOriginEvidence | null
  migrationLineage: MigrationLineage | null
  safetyLock: DurableSafetyLock | null
}
```

Cross-field invariants include contiguous transitions through high water, transition successor/origin/floor agreement, switched disposition evidence matching one transition, ended disposition/certificate bijection, current origin matching the final transition, and reserved-capacity lock validity.
