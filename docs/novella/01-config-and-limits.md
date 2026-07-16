# 01 — Protocol constants and byte-limit derivation

> **Revision 5 changes:** `startRoundMs` replaces `startArbitrationMs` (the start decision is now coordinator-committed, 09 — the timer only bounds proposal collection at the coordinator, it no longer *is* the decision); `sessionEpoch` documented as a protocol constant concern; `maxEffectVariables` bounds authoring so the engine's transport-limit enforcement (05) can never reject a validated story's reachable states.

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
  startRoundMs: 1_500,     // coordinator's proposal-collection window (09)
  electionRoundMs: 2_000,  // advertisement collection + supersession window (10)
  canonicalSendRetries: 1,
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
- Each peer tracks `latestEpoch` (the highest epoch it has ever installed or seen tombstoned); proposals, starts, and advertisements at or below a decided epoch are ignored (the decided-round guard, 09).

## Timing constants

- `requestTimeoutMs` — a participant request with no canonical response re-enables the UI (13).
- `startRoundMs` — how long the **coordinator** collects `START_PROPOSE` before committing (09). Peers other than the coordinator run no start timer: they install only on `START_COMMITTED`, which is what makes convergence delivery-order-independent.
- `electionRoundMs` — advertisement collection at the frozen winner and the supersession window at replicas (10).
- `canonicalSendRetries` — controller resend attempts before snapshot repair (12); `SESSION_ENDED` has its own persistence rule instead (11).
