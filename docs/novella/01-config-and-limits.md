# 01 — Protocol constants, epochs, and canonical ordering

> **Revision 9 changes:** adds separate retirement/outcome bounds and defines strongest-baseline selection used by start and migration handlers.

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
  maxRetiredSessions: 32,
  maxCompletedEndCertificates: 16,
  maxOutstandingRecoveries: 16,

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

Retry timers affect activity only. They never expire protocol authorization.

## Epoch rules

- first committed session: epoch 1;
- start/switch: `highWaterEpoch + 1`;
- proposal stale at `candidateEpoch <= highWaterEpoch`;
- decision/gossip stale at `< highWaterEpoch`;
- other state traffic stale at `< highWaterEpoch`;
- `epochOutcome.epoch === highWaterEpoch` whenever high water is non-zero;
- an `ended` outcome rejects every start decision for that epoch;
- a higher epoch replaces the previous current outcome;
- retirement records protect exact sessions; high water protects trimmed old epochs.

## Canonical semantic ordering

Canonicalize recursively, sort object keys with code-unit `<`, omit diagnostic `updatedAt`, encode UTF-8, and compare unsigned bytes. Never use `localeCompare`.

```ts
export const compareSessionPriority = (a, b): number =>
  a.sessionEpoch - b.sessionEpoch ||
  a.revision - b.revision ||
  -compareAscii(a.controllerPeerId, b.controllerPeerId) ||
  -compareAscii(a.sessionId, b.sessionId) ||
  -compareBytes(canonicalStateBytes(a), canonicalStateBytes(b))
```

Positive means `a` wins. Equality means equal normalized semantic state.

## Strongest known baseline

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

Only compare states for the relevant epoch/protocol decision. Handlers use:

- start: `strongestState(live, checkpoint, activeDecision?.state)`;
- migration: `strongestState(live, activeMigration.lastAppliedState)`;
- recovery: the baseline prescribed by its recovery kind.

A revision-0 decision is evidence of origin, not a replacement for progressed state.

## Bounded IDs and bytes

`deriveRoundId` remains bounded FNV-1a bookkeeping over canonical raw fields. Validators recompute it; it is not a signature. All aggregate values use non-throwing UTF-8 byte measurement and final envelope/snapshot limits.
