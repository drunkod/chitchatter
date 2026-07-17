# 01 — Protocol constants, epochs, and canonical ordering

> **Revision 8 changes:** replaces locale-sensitive comparison with canonical UTF-8 byte ordering, adds recovery-record bounds, and states that authorization records are cleared by protocol events rather than wall-clock expiry.

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
  maxPersistedTombstones: 16,
  maxOutstandingRecoveries: 16,

  requestTimeoutMs: 10_000,
  startRoundMs: 1_500,
  startReconcileRetryMs: 3_000,
  electionRoundMs: 2_000,
  migrationRetryMs: 8_000, // retry cadence only; never an authorization deadline
  terminationAckTimeoutMs: 8_000,
  recoveryRecordTtlMs: 30_000,
  canonicalSendRetries: 1,
} as const

export const visualNovelBootstrapScope = {
  sessionId: 'bootstrap', storyId: 'bootstrap', storyVersion: '0.0.0',
} as const
```

## Epoch rules

- first committed session is epoch 1;
- start and switch create `highWaterEpoch + 1`;
- proposal epoch is stale at `<= highWaterEpoch`;
- decision/gossip epoch is stale only at `< highWaterEpoch`;
- other state-carrying traffic is stale at `< highWaterEpoch`;
- higher epoch clears older active-start and active-migration records;
- ending a session clears records for that exact epoch.

## Bounded identifiers

`deriveRoundId` remains the synchronous 64-bit FNV-1a digest encoded as `r` plus sixteen lowercase hex characters. Raw authoritative fields remain in the payload and are revalidated; the digest is bookkeeping, not a signature.

## Canonical semantic-state bytes

Distributed ordering must never use `localeCompare`, host locale, insertion order, or engine-specific collation. Canonicalize recursively, omit non-semantic `updatedAt`, and compare UTF-8 bytes unsigned:

```ts
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'updatedAt')
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, canonicalize(item)])
    )
  }
  return value
}

export const canonicalStateBytes = (state: VisualNovelSessionState): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(canonicalize(state)))

const compareBytes = (a: Uint8Array, b: Uint8Array): number => {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1
}

const compareAscii = (a: string, b: string): number =>
  a === b ? 0 : a < b ? -1 : 1

// Positive means a wins. Higher epoch/revision wins; lower stable IDs and
// lower canonical bytes win ties.
export const compareSessionPriority = (
  a: VisualNovelSessionState,
  b: VisualNovelSessionState,
): number =>
  a.sessionEpoch - b.sessionEpoch ||
  a.revision - b.revision ||
  -compareAscii(a.controllerPeerId, b.controllerPeerId) ||
  -compareAscii(a.sessionId, b.sessionId) ||
  -compareBytes(canonicalStateBytes(a), canonicalStateBytes(b))
```

An equality result means equal normalized semantic state. History arrays retain protocol order; every object key is sorted recursively.

## Byte budgets

Use the non-throwing `utf8Bytes` helper for aggregate collections and final envelopes. Engine variable guards run before a transition commits. Snapshot history is truncated by count and encoded bytes before final `maxSnapshotBytes` validation.
