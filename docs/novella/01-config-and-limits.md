# 01 — Protocol constants, epochs, and deterministic ordering

> **Revision 7 changes:** separates proposal staleness from decision staleness, adds reconciliation and metadata timing limits, and defines canonical state comparison used by both start and election convergence.

## `src/config/visualNovel.ts`

```ts
export const visualNovelProtocolVersion = 1 as const

export const visualNovelLimits = {
  maxEnvelopeBytes: 96 * 1024,
  maxSnapshotBytes: 64 * 1024,
  maxVariablesBytes: 24 * 1024,
  maxHistoryBytes: 16 * 1024,

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
  maxRoomMetaBytes: 2 * 1024 * 1024,

  requestTimeoutMs: 10_000,
  startRoundMs: 1_500,
  startReconcileRetryMs: 3_000,
  electionRoundMs: 2_000,
  migrationSupersessionMs: 8_000,
  terminationAckTimeoutMs: 8_000,
  canonicalSendRetries: 1,
} as const

export const visualNovelBootstrapScope = {
  sessionId: 'bootstrap',
  storyId: 'bootstrap',
  storyVersion: '0.0.0',
} as const
```

## Byte budgets

All encoded sizes use one non-throwing helper:

```ts
export const utf8Bytes = (value: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}
```

Variables and truncated history have independent aggregate limits, followed by a final `maxSnapshotBytes` check. The engine applies the variable checks before committing a transition.

## Epoch rules

`sessionEpoch` is room-monotonic safety metadata:

- first committed session: epoch 1;
- fresh start or controller switch: `highWaterEpoch + 1`;
- `noteEpoch` persists before the new state becomes interactive;
- tombstoning persists the same or newer epoch;
- other state-carrying events are stale at `embeddedEpoch < highWaterEpoch`.

Start actions are intentionally split:

```ts
const isStaleStartProposal = (epoch: number, highWater: number) =>
  epoch <= highWater

const isStaleStartDecision = (epoch: number, highWater: number) =>
  epoch < highWater
```

A same-epoch decision must reach reconciliation. Treating decisions as stale at `<=` would make partial-commit recovery impossible.

## Bounded round and decision IDs

```ts
export const deriveRoundId = (canonical: string): string => {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < canonical.length; i++) {
    hash ^= BigInt(canonical.charCodeAt(i))
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return `r${hash.toString(16).padStart(16, '0')}`
}
```

Raw fields remain in payloads and validators recompute the ID. The digest is a bounded bookkeeping key, not a security signature.

## Canonical state comparison

All same-epoch start reconciliation and migration supersession use one comparator. It must be total over the complete normalized state:

```ts
export const stableStateString = (state: VisualNovelSessionState): string =>
  JSON.stringify({
    ...state,
    variables: Object.fromEntries(
      Object.entries(state.variables).sort(([a], [b]) => a.localeCompare(b))
    ),
  })

export const compareSessionPriority = (
  a: VisualNovelSessionState,
  b: VisualNovelSessionState
): number =>
  a.sessionEpoch - b.sessionEpoch ||
  a.revision - b.revision ||
  // Lower IDs win ties; invert for a “positive means a wins” comparator.
  -a.controllerPeerId.localeCompare(b.controllerPeerId) ||
  -a.sessionId.localeCompare(b.sessionId) ||
  -stableStateString(a).localeCompare(stableStateString(b))
```

History order is already canonical; variable keys are sorted. An equal comparator result therefore means equal normalized state, not merely equal revision metadata.
