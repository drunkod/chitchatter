# 02 — Data models and durable protocol records

> **Revision 10 changes:** introduces structured retirement gossip, a comparator floor, migration lineage, symmetric conflict descriptors, and explicit transaction tokens.

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
  | 'SESSION_RETIREMENT_GOSSIP'
  | 'ELECTION_ADVERTISE' | 'CONTROLLER_CHANGED'
  | 'CONTROL_REQUEST' | 'CONTROL_PASSED'
  | 'RESTART_REQUEST' | 'RESTARTED' | 'ERROR'
```

## Durable evidence

```ts
export interface StartDecisionRecord extends Record<string, unknown> {
  decisionId: string
  coordinatorPeerId: string
  originActionId: string
  state: VisualNovelSessionState // revision 0
}

export interface SessionDisposition extends Record<string, unknown> {
  sessionId: string
  sessionEpoch: number
  storyId: string
  storyVersion: string
  reason: 'ended' | 'switched' | 'reconciled'
  decidedByActionId: string
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

## Symmetric conflicts

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

export interface StateConflict {
  descriptor: ConflictDescriptor
  localState: VisualNovelSessionState
  remoteState: VisualNovelSessionState
  localDecision: StartDecisionRecord | null
  remoteDecision: StartDecisionRecord | null
}
```

The two state digests and two session IDs are sorted bytewise before deriving `conflictId`; therefore opposite peers derive the same descriptor.

## Migration lineage

```ts
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
  records: MigrationRecord[] // canonical order by openedAtRevision, migrationId
}
```

Every sequential controller departure appends a record. Records remain until exact-session terminal disposition, higher epoch, or reset. Current-epoch lineage is never trimmed; bound exhaustion fails closed.

## Payloads

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
    descriptor: ConflictDescriptor
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
  SESSION_RETIREMENT_GOSSIP: { disposition: SessionDisposition }

  ELECTION_ADVERTISE: { roundId: string; state: VisualNovelSessionState }
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

export interface PendingTermination {
  sessionId: string
  sessionEpoch: number
  envelope: EnvelopeFor<'SESSION_ENDED'>
  recipients: Set<string>
  acked: Set<string>
}

export interface AppliedGenerationToken {
  roomScope: string
  generation: number
  outcomeFloorDigest: string
}
```

## Persistent RoomMeta

```ts
export interface RoomMeta {
  version: 1
  generation: number
  highWaterEpoch: number
  epochOutcome: EpochOutcome | null
  dispositions: SessionDisposition[]
  completedEndCertificates: CompletedEndCertificate[]
  activeStartDecision: StartDecisionRecord | null
  migrationLineage: MigrationLineage | null
}
```

Cross-field invariants:

- high water 0 iff outcome, active decision, and lineage are null and no historical records exist;
- nonzero high water has an outcome at exactly high water;
- high water is at least every disposition/certificate/decision/lineage epoch;
- outcome floor exactly matches outcome epoch/session;
- ended outcome has no active decision or migration lineage;
- active decision matches the active outcome’s session/epoch/story;
- migration lineage matches the active outcome’s session/epoch;
- each migration last state matches lineage session/epoch/story;
- dispositions and certificates are unique and canonically sorted;
- every certificate has a matching `ended` disposition;
- certificate fields match the embedded original end envelope and payload epoch;
- active outcome session has no terminal disposition while status is active;
- `reconciled` disposition at the active epoch is allowed but nonterminal;
- current-epoch records obey dedicated non-trimming bounds.
