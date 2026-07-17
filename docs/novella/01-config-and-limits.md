# 01 — Protocol constants, RFC 8785 ordering, epochs, and safety locks

> **Revision 12 changes:** replaces the custom JSON wording with exact RFC 8785/JCS bytes, adds retained transition-chain and emergency-reserve limits, and defines a complete safety-lock recovery matrix.

## Limits

```ts
export const visualNovelProtocolVersion = 1 as const

export const visualNovelLimits = {
  maxEnvelopeBytes: 96 * 1024,
  maxSnapshotBytes: 64 * 1024,
  maxVariablesBytes: 24 * 1024,
  maxHistoryBytes: 16 * 1024,

  maxRoomMetaBytes: 2 * 1024 * 1024,
  roomMetaEmergencyReserveBytes: 4096,
  maxOperationalRoomMetaBytes: 2 * 1024 * 1024 - 4096,

  maxHistoryEntries: 256,
  maxSnapshotHistoryEntries: 32,
  maxVariables: 128,
  maxVariableValueLength: 256,
  maxEffectVariables: 96,
  maxScenes: 256,
  maxDialogueEntriesPerScene: 512,
  maxChoicesPerEntry: 16,
  maxIdLength: 128,
  maxTextLength: 8 * 1024,

  maxSeenActionIds: 2048,
  maxHistoricalDispositions: 48,
  maxHistoricalEndCertificates: 24,
  maxCurrentEpochDispositions: 16,
  maxCurrentEpochEndCertificates: 16,
  maxEpochTransitions: 64,
  maxMigrationLineage: 8,
  maxOutstandingRecoveries: 16,
  maxOpenConflicts: 16,
  maxSupersessionChain: 64,

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

Normal metadata mutations must remain below `maxOperationalRoomMetaBytes`. The reserved bytes are available only for the compact durable safety lock and its generation update.

## Semantic state object

Construct a fresh object containing exactly:

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

`updatedAt` and unknown fields are excluded only because they are absent from this semantic schema.

## Exact RFC 8785/JCS serialization

`canonicalStateBytes` is UTF-8 of the RFC 8785 JSON Canonicalization Scheme serialization of the semantic object.

Required profile:

- input is I-JSON-compatible; reject lone UTF-16 surrogates and nonfinite numbers;
- object property names sort lexicographically by UTF-16 code units exactly as RFC 8785 specifies;
- strings use the RFC 8785 escaping rules: escape control characters, quote, and backslash only; do not escape `/` or ordinary non-ASCII characters;
- hexadecimal escape digits are lowercase;
- numbers use the ECMAScript/IEEE-754 shortest round-trippable serialization required by RFC 8785;
- `-0` serializes as `0`;
- no whitespace is emitted;
- arrays retain their validated order.

Do not substitute locale order, UTF-8 key order, insertion order, ordinary `JSON.stringify` over unsorted objects, or a third-party “stable JSON” package without RFC 8785 conformance fixtures.

## Exact state digest and ordering

```text
stateDigest = lowercaseHex(
  SHA-256(
    UTF8("chitchatter-visual-novel-state-v1\0") ||
    canonicalStateBytes
  )
)
```

The digest is exactly 64 lowercase hexadecimal characters. Browser code uses Web Crypto SHA-256; Node tests use the corresponding SHA-256 implementation.

```ts
const compareStatePriority = (a: ValidatedState, b: ValidatedState): number =>
  compareSafeInt(a.state.sessionEpoch, b.state.sessionEpoch) ||
  compareSafeInt(a.state.revision, b.state.revision) ||
  -compareUtf8(a.state.controllerPeerId, b.state.controllerPeerId) ||
  -compareUtf8(a.state.sessionId, b.state.sessionId) ||
  -compareDigestBytes(a.digest, b.digest)
```

`compareStateToFloor` uses the identical tuple. Equal digest with unequal canonical bytes enters a digest-collision safety lock.

## Epoch transition rules

- Epoch 1 has an `initial-start` transition with no predecessor.
- Every later epoch has exactly one transition whose predecessor epoch is `epoch - 1`.
- Transition kinds are `start-after-ended` and `switch`.
- Transition successor state is revision 0 and exactly matches the successor floor.
- `epochTransitions` is contiguous, canonically ordered, and never trimmed before explicit reset.
- Transition-capacity exhaustion enters the durable capacity lock rather than discarding provenance.

## Terminality

```ts
const dispositionIsTerminal = (d: SessionDisposition, meta: RoomMeta): boolean => {
  if (d.sessionEpoch < meta.highWaterEpoch) return true
  if (d.reason === 'ended') return hasExactCompletedEndCertificate(meta, d)
  return false
}
```

A `switched` record is persisted only as historical evidence below high water in the same transaction as its transition. `reconciled` remains nonterminal at active high water.

## Safety-lock matrix

Durable metadata lock kinds:

| Kind | Entry | Permitted clearing |
| --- | --- | --- |
| `capacity` | current evidence/transition/lineage or operational byte limit reached | verified higher-epoch safety recovery chain, or explicit reset |
| `digest-collision` | same digest, unequal RFC 8785 bytes | explicit reset after protocol upgrade only |

Runtime-only states:

| Kind | Entry | Permitted clearing |
| --- | --- | --- |
| `lock-unavailable` | Web Lock missing/denied/probe failure | successful local capability reprobe and coherent bootstrap |
| `storage-failure` | read/write/transaction/store failure | successful local storage repair, emergency-marker check, and coherent bootstrap |

The generic gate rejects installs while locked, except the dedicated pre-gate `SAFETY_RECOVERY_GOSSIP` path for a durable `capacity` lock. Same-epoch evidence never clears a lock.
