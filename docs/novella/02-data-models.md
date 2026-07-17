# 02 — Data models, origins, successor evidence, conflicts, and lineage

> **Revision 11 changes:** generalizes persisted session provenance to `activeOrigin`, adds successor evidence for switched notices, makes disposition identity deterministic, and binds recoveries to the expected floor digest.

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

export interface ValidatedState {
  state: VisualNovelSessionState
  digest: string
  canonicalBytes: Uint8Array
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

## Origin and durable evidence

```ts
export interface StartDecisionRecord extends Record<string, unknown> {
  decisionId: string
  coordinatorPeerId: string
  originActionId: string
  state: VisualNovelSessionState // revision 0
}

export type SessionOriginEvidence =
  | {
      kind: 'start-decision'
      decision: StartDecisionRecord
    }
  | {
      kind: 'session-started'
      actionId: string
      controllerPeerId: string
      state: VisualNovelSessionState // revision 0 for the new epoch
    }

export interface SessionDisposition extends Record<string, unknown> {
  sessionId: string
  sessionEpoch: number
  storyId: string
  storyVersion: string
  reason: 'ended' | 'switched' | 'reconciled'
  evidenceId: string // end action, successor-origin ID, or conflict ID
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

export interface SuccessorEvidence extends Record<string, unknown> {
  outcome: EpochOutcome
  origin: SessionOriginEvidence
  knownState: VisualNovelSessionState | null
}
```

`knownState`, when present, exactly matches the successor outcome floor digest. When absent, the receiver enters floor-only exact recovery.

## Symmetric, rebasable conflicts

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
  localOrigin: SessionOriginEvidence | null
  remoteOrigin: SessionOriginEvidence | null
}
```

Session IDs and digests are independently sorted by unsigned bytes before deriving `conflictId`. The descriptor correlates prior evidence; it is not frozen authorization. A receiver whose baseline advanced rebases against the latest state.

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
  records: MigrationRecord[]
}
```

Records are canonical by `(openedAtRevision, migrationId)`. Current-epoch lineage never trims.

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
    origin?: SessionOriginEvidence
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
  SESSION_RETIREMENT_GOSSIP: {
    disposition: SessionDisposition
    successor: SuccessorEvidence | null
  }

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
  expectedFloorDigest: string | null
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

export interface ConsistentBootstrapSnapshot {
  roomScope: string
  generation: number
  meta: RoomMeta
  checkpoint: VisualNovelSessionState | null
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
  activeOrigin: SessionOriginEvidence | null
  migrationLineage: MigrationLineage | null
  safetyLock: NovellaSafetyLock | null
}
```

Cross-field invariants:

- high water 0 iff there is no outcome, origin, lineage, historical evidence, or safety lock tied to protocol state;
- nonzero high water has an outcome at exactly high water;
- every record epoch is `<= highWaterEpoch`;
- outcome floor exactly matches outcome epoch/session/story;
- ended outcome has no active origin or migration lineage;
- active origin matches active outcome session/epoch/story and starts at revision 0;
- migration lineage matches active outcome session/epoch/story;
- every certificate has one exact ended disposition and vice versa;
- switched disposition is historical below high water and its `evidenceId` identifies the successor origin;
- reconciled disposition at active high water is nonterminal;
- disposition logical key is `(epoch, sessionId, reason)`;
- duplicate logical keys are merged deterministically rather than appended;
- current-epoch evidence obeys non-trimming limits;
- safety-lock state is structurally bounded and blocks state installation.
