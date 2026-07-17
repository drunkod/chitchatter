# 01 — Protocol constants, digest ordering, terminality, and safety capacity

> **Revision 11 changes:** specifies the exact canonical-state SHA-256 function, makes that digest the global final tie-break, corrects ended/switched terminality, and defines the room-wide safety lock used for capacity or lock-capability failures.

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

Timers govern retry activity only. They never expire durable authority.

## Exact semantic bytes

Construct a new semantic object with only these normalized fields, in this order-independent schema:

```ts
{
  protocolVersion,
  storyId,
  storyVersion,
  sessionId,
  sessionEpoch,
  sceneId,
  dialogueEntryId,
  variables,
  history,
  controllerPeerId,
  revision,
}
```

`updatedAt` is omitted only at the top-level state schema. Do not recursively delete arbitrary properties named `updatedAt`.

Canonical JSON rules:

- strings use JSON escaping and Unicode scalar values as normalized input already accepted by validators;
- object keys are sorted by unsigned UTF-8 bytes, not locale or UTF-16 collation;
- arrays preserve order;
- numbers are finite safe JSON numbers and use the implementation’s validated canonical JSON number encoder;
- no whitespace;
- unknown fields were already dropped by normalization.

`canonicalStateBytes` is UTF-8 of that canonical JSON.

## Exact state digest

```text
stateDigest = lowercaseHex(
  SHA-256(
    UTF8("chitchatter-visual-novel-state-v1\0") ||
    canonicalStateBytes
  )
)
```

Requirements:

- exactly 64 lowercase hexadecimal characters;
- Web Crypto SHA-256 in browsers and the corresponding Node SHA-256 in tests;
- digest computed and cached after structural/semantic validation, before authorization;
- FNV-derived IDs remain bookkeeping only and are never used for state equality or ordering.

If two complete normalized states produce the same digest but different canonical bytes, enter a persistent protocol-collision safety error. Never choose one arbitrarily.

## One total ordering

Use relational comparisons rather than integer subtraction:

```ts
const compareStatePriority = (a: ValidatedState, b: ValidatedState): number =>
  compareSafeInt(a.state.sessionEpoch, b.state.sessionEpoch) ||
  compareSafeInt(a.state.revision, b.state.revision) ||
  -compareUtf8(a.state.controllerPeerId, b.state.controllerPeerId) ||
  -compareUtf8(a.state.sessionId, b.state.sessionId) ||
  -compareDigestBytes(a.digest, b.digest)
```

Positive means `a` wins. Lower controller ID, session ID, and digest win ties. `compareStateToFloor` uses exactly the same tuple. This is the only distributed ordering.

## Canonical comparator floor

```ts
interface CanonicalStateFloor {
  sessionId: string
  sessionEpoch: number
  storyId: string
  storyVersion: string
  controllerPeerId: string
  revision: number
  stateDigest: string
}
```

A state below the floor is stale. Equal priority requires exact digest equality. A higher state installs only through an authorized complete-state path. Every canonical exposure advances the floor transactionally.

## Epoch and terminality rules

- first committed session is epoch 1;
- fresh start/switch creates `highWaterEpoch + 1`;
- every durable record epoch is `<= highWaterEpoch`;
- ended high-water outcome blocks every same-epoch state-installing action;
- higher epoch supersedes every older epoch;
- current-high-water safety evidence never trims.

```ts
const dispositionIsTerminal = (
  disposition: SessionDisposition,
  meta: RoomMeta,
): boolean => {
  if (disposition.sessionEpoch < meta.highWaterEpoch) return true
  if (disposition.reason === 'ended') {
    return hasExactCompletedEndCertificate(meta, disposition)
  }
  // A valid switched disposition is merged only with successor evidence,
  // which raises high water above its epoch.
  return false
}
```

`reconciled` is nonterminal at active high water. `SESSION_RETIREMENT_GOSSIP` never authoritatively carries `ended`; completed-end gossip carries certificate and disposition together.

## Safety lock

`RoomMeta` or runtime may enter:

```ts
type NovellaSafetyLock =
  | { kind: 'capacity'; code: string }
  | { kind: 'lock-unavailable'; code: string }
  | { kind: 'digest-collision'; code: string }
  | { kind: 'storage-failure'; code: string }
```

While locked:

- disable all novella state-changing controls and outgoing state requests;
- reject state-installing network actions;
- retain chat/media/file functionality;
- permit only verified higher-epoch successor recovery or explicit user-confirmed reset when the lock kind allows it;
- show a persistent actionable error.
