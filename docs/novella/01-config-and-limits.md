# 01 — Protocol constants and byte-limit derivation

> **Revision 6 changes:** `terminationAckTimeoutMs` (per-cycle ack wait, 11) and `maxPersistedTombstones` (RoomMeta bound, 15); the **`deriveRoundId` bounded synchronous digest** replaces concatenated round IDs, which violated `isId`'s charset and length; epoch documentation now states persistence (RoomMeta) and the action-aware `≤`/`<` gate semantics. The `maxEffectVariables` authoring bound stands, with its guarantee reworded honestly in 04 (names and value width, not looped increments).

## `src/config/visualNovel.ts`

```ts
export const visualNovelProtocolVersion = 1 as const

export const visualNovelLimits = {
  // ---- transport-level byte budgets (derivation below) ----
  maxEnvelopeBytes: 96 * 1024,
  maxSnapshotBytes: 64 * 1024,
  maxVariablesBytes: 24 * 1024, // aggregate encoded bytes of state.variables
  maxHistoryBytes: 16 * 1024,   // aggregate encoded bytes of state.history

  // ---- element-level bounds ----
  maxHistoryEntries: 256,          // in-memory only
  maxSnapshotHistoryEntries: 32,   // what actually travels in snapshots
  maxVariables: 128,
  maxVariableValueLength: 256,     // characters; bytes bounded by maxVariablesBytes
  maxEffectVariables: 96,          // distinct variable names reachable from a
                                   // story's effects (authoring bound < maxVariables,
                                   // headroom for engine-internal variables)
  maxScenes: 256,
  maxDialogueEntriesPerScene: 512,
  maxChoicesPerEntry: 16,
  maxIdLength: 128,
  maxLabelLength: 256,
  maxTextLength: 8 * 1024,
  maxSeenActionIds: 2048,

  // ---- timing ----
  requestTimeoutMs: 10_000,
  startRoundMs: 1_500,          // coordinator's proposal-collection window (09)
  electionRoundMs: 2_000,       // advertisement collection + supersession window (10)
  terminationAckTimeoutMs: 8_000, // per-cycle wait for SESSION_END_ACKs (11)
  canonicalSendRetries: 1,
  maxPersistedTombstones: 16,   // room meta endedSessions bound (15)
} as const

// Reserved scope for STATE_REQUEST / START_PROPOSE sent by a peer that has
// no session state yet. See 09/12.
export const visualNovelBootstrapScope = {
  sessionId: 'bootstrap',
  storyId: 'bootstrap',
  storyVersion: '0.0.0',
} as const

export const allowedVisualNovelAssetExtensions = new Set([
  '.avif', '.gif', '.jpeg', '.jpg', '.mp3', '.ogg', '.png', '.webp', '.wav',
])
```

## Byte-limit derivation

All measurements use the single non-throwing helper (03):

```ts
const utf8Bytes = (value: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY // cyclic / non-serializable → oversized
  }
}
```

A snapshot-carried `VisualNovelSessionState` is bounded as the sum of independently enforced parts, so the whole cannot exceed its budget even at worst-case JSON escaping (each character ≤ 6 encoded bytes):

| Component | Enforced by | Worst-case bytes |
| --- | --- | --- |
| `variables` | `utf8Bytes(variables) ≤ maxVariablesBytes` (aggregate) — enforced by validator (03) **and by the engine before committing any transition (05)** | 24 576 |
| `history` (truncated) | `utf8Bytes(history) ≤ maxHistoryBytes` | 16 384 |
| 6 identifier fields + `sessionEpoch`/`revision`/`updatedAt` + keys | field checks | ≈ 5 100 |
| JSON structure overhead | — | ≈ 1 000 |
| **Total** | `utf8Bytes(state) ≤ maxSnapshotBytes` (final gate) | **≈ 47 KB < 64 KB** ✓ |

Envelope = snapshot + identifiers + payload wrapper: `64 KB + ≈ 6 KB ≪ 96 KB` ✓

Three consequences implemented elsewhere:

1. Validators apply `utf8Bytes` to aggregate collections (03).
2. **The engine refuses transitions whose resulting variables violate count/byte/finiteness limits** (05) — the controller can therefore never enter a locally-legal-but-untransmittable state, and story validation (04) bounds effect-reachable variables (`maxEffectVariables`) so authored stories cannot hit that refusal in normal play.
3. The "maximal legal state" test (16) uses worst-case-encoding characters, not ASCII.

`toSnapshotState` (03) enforces both `maxSnapshotHistoryEntries` and `maxHistoryBytes`.

## Session epochs

`sessionEpoch` is a room-monotonic integer carried inside every session state (02):

- The first committed session in a room has epoch `1`.
- `START_COMMITTED` assigns `latestKnownEpoch + 1` (09); `switchSession` increments it (09).
- All ordering that compares sessions — election adoption, snapshot preference, stale-event gating — orders by `(sessionEpoch, revision)`, never by revision alone (08/10).
- Each peer tracks `latestEpoch` (the highest epoch it has ever installed or seen tombstoned). The gate is **action-specific** (08): start actions are dropped at `embedded.sessionEpoch ≤ latestEpoch` (a decided epoch may never reopen), other state-carrying actions at `< latestEpoch` (same-epoch traffic is legitimate).
- **`latestEpoch` and tombstones persist** in room meta storage (15) and are loaded into the sync service before it processes any envelope. In-memory-only epoch tracking would reset to 0 on a full-room reload, making stale epoch-5 state "newer" and forgetting ended sessions — the meta record is safety data and survives checkpoint deletion.

## Round identifiers

Round IDs must pass `isId` (03): ≤ 128 chars, `[A-Za-z0-9][A-Za-z0-9._:-]*`. Concatenating an electorate into the ID violates both the charset (`|`) and, at up to 64 members × 128 chars, the length — so round identity uses a **bounded synchronous digest** (10):

```ts
// FNV-1a 64-bit over the canonical round string, hex-encoded (16 chars).
// Collision resistance is not load-bearing: the payload carries the raw
// round fields (departed, electorate, epoch) and receivers compare those
// exactly and recompute the digest to verify the binding (10).
export const deriveRoundId = (canonical: string): string => {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < canonical.length; i++) {
    hash ^= BigInt(canonical.charCodeAt(i))
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return `r${hash.toString(16).padStart(16, '0')}`
}
```

Synchronous on purpose: rounds open inside transport callbacks, where `crypto.subtle` (async) would race the events being gated.

## Timing constants

- `requestTimeoutMs` — a participant request with no canonical response re-enables the UI (13).
- `startRoundMs` — how long the **coordinator** collects `START_PROPOSE` before committing (09). Peers other than the coordinator run no start timer: they install only on `START_COMMITTED`, which is what makes convergence delivery-order-independent.
- `electionRoundMs` — advertisement collection at the frozen winner and the supersession window at replicas (10).
- `canonicalSendRetries` — controller resend attempts before snapshot repair (12); `SESSION_ENDED` has its own persistence rule instead (11).
