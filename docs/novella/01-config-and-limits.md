# 01 — Protocol constants and byte-limit derivation

> **Revision 4 changes:** aggregate byte limits `maxVariablesBytes` and `maxHistoryBytes`, measured with the same UTF-8/JSON function used everywhere else. Character-count limits alone were insufficient: JSON escaping expands control characters to six bytes, so 128 variables × 256 chars could serialize to ~196 KB — over the old snapshot limit while being "legal". Limits are now derived so a maximal legal state fits `maxSnapshotBytes` **by construction**, with worst-case encoding. New timing constants for the election round and start arbitration.

## `src/config/visualNovel.ts`

```ts
export const visualNovelProtocolVersion = 1 as const

export const visualNovelLimits = {
  // ---- transport-level byte budgets (see derivation below) ----
  maxEnvelopeBytes: 96 * 1024,
  maxSnapshotBytes: 64 * 1024,
  maxVariablesBytes: 24 * 1024, // aggregate encoded bytes of state.variables
  maxHistoryBytes: 16 * 1024,   // aggregate encoded bytes of state.history

  // ---- element-level bounds ----
  maxHistoryEntries: 256,          // in-memory only
  maxSnapshotHistoryEntries: 32,   // what actually travels in snapshots
  maxVariables: 128,
  maxVariableValueLength: 256,     // characters; bytes bounded by maxVariablesBytes
  maxScenes: 256,
  maxDialogueEntriesPerScene: 512,
  maxChoicesPerEntry: 16,
  maxIdLength: 128,
  maxLabelLength: 256,
  maxTextLength: 8 * 1024,
  maxSeenActionIds: 2048,

  // ---- timing ----
  requestTimeoutMs: 10_000,
  electionRoundMs: 2_000,        // window for ELECTION_ADVERTISE collection
                                 // and CONTROLLER_CHANGED supersession
  startArbitrationMs: 1_500,     // window collecting revision-0 SESSION_STARTED
  canonicalSendRetries: 1,
} as const

// Reserved scope for STATE_REQUEST sent by a peer that has no session state
// yet (late join before any push arrives). See 09.
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

A snapshot-carried `VisualNovelSessionState` is bounded as the **sum of independently enforced parts**, so the whole cannot exceed its budget even at worst-case JSON escaping (each character ≤ 6 encoded bytes, e.g. ``):

| Component | Enforced by | Worst-case bytes |
| --- | --- | --- |
| `variables` | `utf8Bytes(variables) ≤ maxVariablesBytes` (aggregate, not per-value) | 24 576 |
| `history` (truncated to 32 entries) | `utf8Bytes(history) ≤ maxHistoryBytes` | 16 384 |
| 6 identifier fields (≤ 128 chars ≤ 768 B escaped each) + numbers + keys | field checks | ≈ 5 000 |
| JSON structure overhead | — | ≈ 1 000 |
| **Total** | `utf8Bytes(state) ≤ maxSnapshotBytes` (final gate) | **≈ 47 KB < 64 KB** ✓ |

Envelope = snapshot + identifiers + payload wrapper: `64 KB + ≈ 6 KB ≪ maxEnvelopeBytes (96 KB)` ✓

Two consequences the validators (03) must implement:

1. `validateVariables` and the history check apply `utf8Bytes` to the **aggregate** collection, not only per-element character counts.
2. The "maximal legal state" test (13) builds its strings from worst-case-encoding characters (e.g. `''.repeat(256)`), not ASCII.

The engine keeps up to `maxHistoryEntries` (256) in memory; `toSnapshotState` (03) truncates to `maxSnapshotHistoryEntries` (32) — and if a pathological truncated history still exceeds `maxHistoryBytes`, the sender must drop oldest entries until it fits (`toSnapshotState` enforces this, not just entry count).

## Timing constants

- `requestTimeoutMs` — participant-side: a request with no canonical response re-enables the UI (10).
- `electionRoundMs` — length of an election round (08): the winner collects `ELECTION_ADVERTISE` for this window before announcing; replicas keep the round open for supersession comparisons for the same window after the first applied `CONTROLLER_CHANGED`.
- `startArbitrationMs` — length of the start-arbitration phase (09): revision-0 `SESSION_STARTED` candidates are collected with progression locked; the total order `(controllerPeerId, sessionId)` then picks the winner. The `sessionId` tie-break also resolves duplicate starts from the same controller.
- `canonicalSendRetries` — controller-side resend attempts before falling back to a snapshot repair broadcast (09).
