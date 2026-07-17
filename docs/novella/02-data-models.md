# 02 — Data models, compact transitions, paginated proofs, and election transcripts

> **Revision 13 changes:** separates immutable transition origin from mutable current outcome, replaces monolithic supersession evidence with bounded proof pages, defines transcript-bound migration, and makes checkpoint blobs immutable.

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

export interface CanonicalStateFloor extends Record<string, unknown> {
  sessionId: string
  sessionEpoch: number
  storyId: string
  storyVersion: string
  controllerPeerId: string
  revision: number
  stateDigest: string
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

## Subjects, outcomes, and origins

```ts
export interface SessionSubject {
  sessionId: string
  sessionEpoch: number
  storyId: string
  storyVersion: string
}

export interface EpochOutcome extends Record<string, unknown> {
  epoch: number
  canonicalSessionId: string
  status: 'active' | 'ended'
  floor: CanonicalStateFloor
}

export interface StartDecisionCertificate extends Record<string, unknown> {
  decisionId: string
  coordinatorPeerId: string
  originActionId: string
  successorOriginFloor: CanonicalStateFloor
}

export interface SessionStartedCertificate extends Record<string, unknown> {
  actionId: string
  predecessor: SessionSubject
  predecessorRevision: number
  predecessorControllerPeerId: string
  successorOriginFloor: CanonicalStateFloor
}

export type EpochOriginCertificate =
  | { kind: 'start-decision'; certificate: StartDecisionCertificate }
  | { kind: 'session-started'; certificate: SessionStartedCertificate }

export interface SessionOriginEvidence extends Record<string, unknown> {
  kind: 'epoch-transition'
  transitionId: string
}
```

Full revision-0 state is not embedded in compact origin certificates. It is verified when originally accepted and can later be recovered by digest through the snapshot protocol.

## End and transition evidence

```ts
export interface CompletedEndCertificate extends Record<string, unknown> {
  sessionId: string
  sessionEpoch: number
  storyId: string
  storyVersion: string
  endEnvelope: EnvelopeFor<'SESSION_ENDED'>
}

export interface TransitionPredecessor extends Record<string, unknown> {
  subject: SessionSubject
  outcomeAtTransition: EpochOutcome
  completedEndCertificate: CompletedEndCertificate | null
}

export interface EpochTransitionCertificate extends Record<string, unknown> {
  transitionId: string
  kind: 'initial-start' | 'start-after-ended' | 'switch'
  predecessor: TransitionPredecessor | null
  successorSubject: SessionSubject
  successorOriginFloor: CanonicalStateFloor // revision 0
  origin: EpochOriginCertificate
}
```

Rules:

- `initial-start` has null predecessor and successor epoch 1.
- `switch` predecessor is active and has no completed-end certificate.
- `start-after-ended` predecessor is ended and embeds its exact completed-end certificate.
- successor subject/floor/origin agree exactly.
- transition ID uses the `epoch-transition` domain over the certificate without `transitionId`.
- slots below high water are sealed;
- the active high-water slot may be replaced only by a winning same-epoch different-session reconciliation carrying its full compact `originTransition`;
- replacing the active slot updates the predecessor switched disposition to the winning transition ID before that slot becomes historical.

## Dispositions

```ts
export interface SessionDisposition extends Record<string, unknown> {
  sessionId: string
  sessionEpoch: number
  storyId: string
  storyVersion: string
  reason: 'ended' | 'switched' | 'reconciled'
  evidenceId: string
}
```

`ended` references an end action/certificate, `switched` references the transition that created the immediate successor, and `reconciled` references a conflict ID.

## Paginated transition proofs

```ts
export interface CurrentOutcomeEvidence extends Record<string, unknown> {
  outcome: EpochOutcome
  origin: SessionOriginEvidence | null
  endCertificate: CompletedEndCertificate | null
  recoveryTargets: string[]
}

export interface TransitionProofManifest extends Record<string, unknown> {
  proofId: string
  purpose: 'supersession' | 'safety-recovery'
  requestedSubject: SessionSubject
  fromEpochExclusive: number
  toEpochInclusive: number
  pageCount: number
  sourceGeneration: number
  finalPageDigest: string
  currentEvidenceDigest: string
}

export interface TransitionProofPage extends Record<string, unknown> {
  manifest: TransitionProofManifest
  pageIndex: number
  previousPageDigest: string | null
  pageDigest: string
  transitions: EpochTransitionCertificate[]
  currentEvidence: CurrentOutcomeEvidence | null // final page only
}
```

`currentEvidenceDigest` uses the `current-outcome-evidence` domain over normalized current evidence. Define `manifestCore` as purpose, requested subject, epoch range, page count, source generation, and current-evidence digest—excluding `proofId` and `finalPageDigest`. Each `pageDigest` uses the `transition-proof-page` domain over `manifestCore`, page index, previous digest, transitions, and the final-page current-evidence marker. `proofId` uses the `transition-proof` domain over `manifestCore` plus `finalPageDigest`. This ordering has no circular hash dependency.

Pages never contain a current full state. After proof application, an active receiver uses ordinary exact snapshot recovery.

## Conflict descriptors

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
```

`conflictId` uses the exact protocol-ID contract over sorted session IDs, sorted digests, epoch, kind, and optional migration ID.

## Migration lineage and election transcript

```ts
export interface MigrationRecord extends Record<string, unknown> {
  migrationId: string
  migrationRoundId: string
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

export interface ElectionAdvertisementSummary extends Record<string, unknown> {
  advertisementId: string
  migrationRoundId: string
  senderPeerId: string
  candidatePeerId: string
  priority: CanonicalStateFloor
}

export interface ElectionTranscript extends Record<string, unknown> {
  transcriptId: string
  migrationRoundId: string
  advertisements: ElectionAdvertisementSummary[] // sorted by sender ID
  winnerAdvertisementId: string
}
```

The winner is the greatest state priority, then lower candidate peer ID, then lower advertisement ID. The transcript ID is derived from the normalized transcript without `transcriptId`.

## Payload map

```ts
export type EnvelopeFor<T extends VisualNovelActionType> =
  VisualNovelActionEnvelope<VisualNovelPayloadByAction[T]> & { actionType: T }

export type VisualNovelPayloadByAction = {
  START_PROPOSE: { proposalId: string; candidate: VisualNovelSessionState }
  START_COMMITTED: {
    decision: StartDecisionCertificate
    state: VisualNovelSessionState
  }
  START_DECISION_GOSSIP: {
    decision: StartDecisionCertificate
    state: VisualNovelSessionState
  }
  SESSION_RECONCILE: {
    descriptor: ConflictDescriptor
    state: VisualNovelSessionState
    originTransition?: EpochTransitionCertificate
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
  SESSION_SUPERSESSION_GOSSIP: {
    requestActionId: string
    page: TransitionProofPage
  }

  SAFETY_RECOVERY_REQUEST: {
    lockCode: 'evidence-limit' | 'lineage-limit' | 'operational-bytes'
    knownEpoch: number
    knownGeneration: number
  }
  SAFETY_RECOVERY_GOSSIP: {
    requestActionId: string
    page: TransitionProofPage
  }

  ELECTION_ADVERTISE: {
    migrationRoundId: string
    advertisementId: string
    candidatePeerId: string
    state: VisualNovelSessionState
  }
  CONTROLLER_CHANGED: {
    migrationRoundId: string
    transcript: ElectionTranscript
    winningState: VisualNovelSessionState
  }

  CONTROL_REQUEST: Record<string, never>
  CONTROL_PASSED: { controllerPeerId: string }
  RESTART_REQUEST: { expectedRevision: number }
  RESTARTED: { state: VisualNovelSessionState }
  ERROR: { code: string; requestActionId?: string }
}
```

`CONTROLLER_CHANGED` carries the winning pre-change state only. Receivers deterministically apply the pure engine `changeController(winningCandidate)` to derive the installed state, avoiding two full states in one envelope.

## Runtime and persistence records

```ts
export type RecoveryKind =
  | 'bootstrap' | 'revision-gap' | 'start-reconcile'
  | 'migration-reconcile' | 'supersession' | 'safety-recovery'

export interface ProofAssembly {
  proofId: string
  purpose: 'supersession' | 'safety-recovery'
  requestActionId: string
  sourcePeerId: string
  manifest: TransitionProofManifest
  pages: Map<number, TransitionProofPage>
  encodedBytes: number
  createdAt: number
  expiresAt: number
}

export interface DurableSafetyLock {
  kind: 'capacity' | 'digest-collision'
  code: DurableSafetyLockCode
  lockedAtEpoch: number
  lockedAtGeneration: number
}

export interface CheckpointRecord {
  storageKey: string
  sourceGeneration: number
  floorDigest: string
  state: VisualNovelSessionState
}

export interface LatestCheckpointPointer {
  storageKey: string
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
