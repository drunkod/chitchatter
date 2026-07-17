# 01 — Protocol constants, JCS IDs, proof bounds, and safety-lock policy

> **Revision 13 changes:** defines one exact derived-ID function, adds proof-page and assembly limits, distinguishes immutable transition origin from mutable outcome, and makes transition-capacity exhaustion reset-only.

## Limits

```ts
export const visualNovelProtocolVersion = 1 as const

export const visualNovelLimits = {
  maxEnvelopeBytes: 96 * 1024,
  maxSnapshotBytes: 64 * 1024,
  maxTransitionCertificateBytes: 8 * 1024,
  maxTransitionProofPagePayloadBytes: 72 * 1024,
  maxProofPages: 128,
  maxTransitionsPerProofPage: 24,
  maxProofAssemblies: 4,
  maxProofAssemblyBytes: 3 * 1024 * 1024,

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
  maxEpochTransitions: 512,
  maxMigrationLineage: 8,
  maxElectionAdvertisements: 32,
  maxOutstandingRecoveries: 16,
  maxOpenConflicts: 16,

  requestTimeoutMs: 10_000,
  recoveryRecordTtlMs: 30_000,
  proofAssemblyTtlMs: 45_000,
  startRoundMs: 1_500,
  startReconcileRetryMs: 3_000,
  electionRoundMs: 2_000,
  migrationRetryMs: 8_000,
  terminationAckTimeoutMs: 8_000,
  canonicalSendRetries: 1,
} as const
```

Every encoded envelope is measured after serialization. Proof pages reserve envelope overhead and must remain below both the page payload and envelope budgets.

## RFC 8785 state bytes

Construct a fresh semantic object containing exactly:

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

`canonicalStateBytes` is UTF-8 of RFC 8785/JCS serialization. Inputs are I-JSON-compatible. Reject lone UTF-16 surrogates and nonfinite numbers. Property names sort by UTF-16 code units. Strings, numbers, `-0`, escapes, arrays, and whitespace follow RFC 8785 exactly.

## State digest and ordering

```text
stateDigest = lowercaseHex(
  SHA-256(
    UTF8("chitchatter-visual-novel-state-v1\0") ||
    canonicalStateBytes
  )
)
```

```ts
const compareStatePriority = (a: StatePriority, b: StatePriority): number =>
  compareSafeInt(a.sessionEpoch, b.sessionEpoch) ||
  compareSafeInt(a.revision, b.revision) ||
  -compareUtf8(a.controllerPeerId, b.controllerPeerId) ||
  -compareUtf8(a.sessionId, b.sessionId) ||
  -compareDigestBytes(a.stateDigest, b.stateDigest)
```

Positive means `a` wins. Complete states and floors use this identical tuple.

## Exact protocol-derived IDs

All cross-runtime safety IDs use:

```text
deriveProtocolId(domain, value) =
  lowercaseHex(
    SHA-256(
      UTF8("chitchatter-visual-novel-id-v1:" + domain + "\0") ||
      UTF8(JCS(value))
    )
  )
```

The JCS input is a newly constructed normalized object that omits the ID being derived. Required domains:

- `start-decision`
- `epoch-transition`
- `conflict`
- `migration-record`
- `migration-round`
- `election-advertisement`
- `election-transcript`
- `current-outcome-evidence`
- `transition-proof`
- `transition-proof-page`

Action IDs may remain bounded random IDs because authorization never depends on their lexical ordering. Whenever an action ID is included in a certificate, the surrounding derived certificate ID binds it to the remaining normalized fields.

## Immutable transition origin versus current outcome

Each canonical transition slot stores:

- exact successor epoch/session/story;
- immutable revision-0 `successorOriginFloor`;
- compact origin authorization;
- predecessor subject/outcome-at-transition;
- embedded end proof for `start-after-ended`.

Historical slots below high water are sealed. The active high-water slot may be replaced only when an authorized different-session reconciliation state at the same epoch wins the common comparator. The replacement also canonicalizes any predecessor `switched` disposition to the winning transition ID.

The current outcome validates when:

```text
currentOutcome subject == finalTransition successor subject
compareFloor(currentOutcome.floor, finalTransition.successorOriginFloor) >= 0
```

Current outcome may be active or ended and may have any authorized later revision. It is never required to byte-equal the transition’s origin outcome.

## Safety-lock policy

```ts
type DurableSafetyLockCode =
  | 'evidence-limit'
  | 'lineage-limit'
  | 'operational-bytes'
  | 'transition-limit'
  | 'digest-collision'
```

| Code | Remote higher-epoch recovery | Explicit reset |
| --- | --- | --- |
| `evidence-limit` | allowed after deterministic historical compaction and fit preflight | allowed |
| `lineage-limit` | allowed because a higher epoch clears old lineage, subject to fit preflight | allowed |
| `operational-bytes` | allowed only when compaction plus incoming compact proof fits operational bytes | allowed |
| `transition-limit` | forbidden; higher epoch would require another transition | required |
| `digest-collision` | forbidden | required after protocol upgrade |

Runtime-only `lock-unavailable` clears only after capability reprobe and coherent bootstrap. Runtime-only `storage-failure` clears only after local repair, emergency-marker review, and coherent bootstrap.

## Capacity reserve

Normal metadata must remain at or below `maxOperationalRoomMetaBytes`. Reserved bytes are used only to persist the compact durable lock and generation increment. The maximum encoded lock record has a fixture proving it fits the reserve.
