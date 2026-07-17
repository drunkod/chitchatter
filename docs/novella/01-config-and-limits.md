# 01 — Protocol constants, epochs, canonical ordering, and comparator floors

> **Revision 10 changes:** adds migration-lineage/current-epoch bounds, defines terminal versus nonterminal dispositions, adds canonical state floors, and centralizes closed-epoch install checks.

## Limits

```ts
export const visualNovelProtocolVersion = 1 as const

export const visualNovelLimits = {
  maxEnvelopeBytes: 96 * 1024,
  maxSnapshotBytes: 64 * 1024,
  maxVariablesBytes: 24 * 1024,
  maxHistoryBytes: 16 * 1024,
  maxRoomMetaBytes: 2 * 1024 * 1024,

  maxHistoryEntries: 256,
  maxSnapshotHistoryEntries: 32,
  maxVariables: 128,
  maxVariableValueLength: 256,
  maxEffectVariables: 96,
  maxScenes: 256,
  maxDialogueEntriesPerScene: 512,
  maxChoicesPerEntry: 16,
  maxIdLength: 128,
  maxLabelLength: 256,
  maxTextLength: 8 * 1024,

  maxSeenActionIds: 2048,
  maxHistoricalDispositions: 48,
  maxHistoricalEndCertificates: 24,
  maxCurrentEpochDispositions: 16,
  maxCurrentEpochEndCertificates: 16,
  maxMigrationLineage: 8,
  maxOutstandingRecoveries: 16,
  maxOpenConflicts: 16,

  requestTimeoutMs: 10_000,
  recoveryRecordTtlMs: 30_000,
  startRoundMs: 1_500,
  startReconcileRetryMs: 3_000,
  electionRoundMs: 2_000,
  migrationRetryMs: 8_000,
  terminationAckTimeoutMs: 8_000,
  canonicalSendRetries: 1,
} as const
```

Timers control retry activity only. They never expire durable authorization.

## Epoch rules

- first committed session is epoch 1;
- fresh start and switch create `highWaterEpoch + 1`;
- proposals are stale at `candidateEpoch <= highWaterEpoch`;
- decisions/gossip are stale at `< highWaterEpoch`;
- ordinary state traffic is stale at `< highWaterEpoch`;
- `epochOutcome.epoch === highWaterEpoch` whenever high water is nonzero;
- every disposition, certificate, active decision, migration entry, and outcome floor has epoch `<= highWaterEpoch`;
- an ended high-water outcome rejects every state-installing action at that epoch;
- higher epoch terminally supersedes all older epochs;
- old records may be trimmed because high water rejects their traffic;
- records from `highWaterEpoch` are never trimmed.

## Terminality

```ts
const dispositionIsTerminal = (
  disposition: SessionDisposition,
  meta: RoomMeta,
): boolean =>
  disposition.reason === 'ended' ||
  disposition.reason === 'switched' ||
  disposition.sessionEpoch < meta.highWaterEpoch
```

`reconciled` records at the active high-water epoch are nonterminal. They suppress local request/progression confusion and clear checkpoints, but complete state evidence may still dispatch and compete.

## Canonical state ordering

Canonicalize recursively, sort object keys with code-unit ordering, omit diagnostic `updatedAt`, encode UTF-8, and compare unsigned bytes. Never use `localeCompare`.

```ts
export const compareSessionPriority = (a, b): number =>
  a.sessionEpoch - b.sessionEpoch ||
  a.revision - b.revision ||
  -compareAscii(a.controllerPeerId, b.controllerPeerId) ||
  -compareAscii(a.sessionId, b.sessionId) ||
  -compareBytes(canonicalStateBytes(a), canonicalStateBytes(b))
```

Positive means `a` wins. Same session/epoch states are comparable only after exact story ID/version equality is verified.

## Canonical comparator floor

```ts
export interface CanonicalStateFloor {
  sessionId: string
  sessionEpoch: number
  storyId: string
  storyVersion: string
  controllerPeerId: string
  revision: number
  stateDigest: string
}

export const floorFromState = (state: VisualNovelSessionState): CanonicalStateFloor => ({
  sessionId: state.sessionId,
  sessionEpoch: state.sessionEpoch,
  storyId: state.storyId,
  storyVersion: state.storyVersion,
  controllerPeerId: state.controllerPeerId,
  revision: state.revision,
  stateDigest: digestCanonicalState(state),
})
```

`compareStateToFloor` applies epoch/revision/controller/session ordering and compares the canonical digest when all preceding fields tie. A state equal to the floor must have the exact digest. A state below the floor is never installed. A higher state may install only through an authorized complete-state path.

Every canonical progression, restart, migration, reconciliation, start, and switch advances the floor in the same transaction that exposes state.

## Strongest full-state baseline

```ts
export const strongestState = (
  ...states: Array<VisualNovelSessionState | null | undefined>
): VisualNovelSessionState | null =>
  states.filter(Boolean).reduce<VisualNovelSessionState | null>(
    (best, next) => best === null || compareSessionPriority(next!, best) > 0
      ? next!
      : best,
    null,
  )
```

Handlers filter to the relevant epoch and immutable story identity before calling it.

## Closed-epoch helper

All state-installing handlers call one helper after authorization and again inside the locked mutation:

```ts
assertEpochInstallable(meta, incoming) {
  if (incoming.sessionEpoch < meta.highWaterEpoch) throw stale()
  if (
    meta.epochOutcome?.epoch === incoming.sessionEpoch &&
    meta.epochOutcome.status === 'ended'
  ) throw closedEpoch()
}
```

## Bounded IDs and bytes

`deriveRoundId` remains bounded FNV-1a bookkeeping over canonical raw fields. It is not a signature. Conflict IDs and migration IDs include their raw fields in the payload and are recomputed. Aggregate values use non-throwing UTF-8 measurement and final envelope/snapshot limits.
