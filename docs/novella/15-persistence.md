# 15 — Checkpoints and room safety metadata

> **Revision 7 changes:** validates metadata, restores retained notices and the active start decision, makes critical writes awaited, and guarantees the live sync receiver mounts only after metadata bootstrap.

## Storage keys

```text
visual-novel:v1:<roomScope>:meta        → RoomMeta
visual-novel:v1:<roomScope>:latest      → active checkpoint session ID
visual-novel:v1:<roomScope>:<sessionId> → truncated checkpoint state
```

`roomScope` is an asynchronous SHA-256-derived identifier. Raw private room URLs and secrets are never stored.

## Bootstrap contract

1. derive `roomScope`;
2. read and normalize `RoomMeta` with `validateRoomMeta`;
3. if metadata is malformed, show a blocking recovery/reset UI—do not attach receivers with empty safety state;
4. mount the ready runtime with `initialMeta`;
5. load the provisional checkpoint;
6. attach the sync receiver from the ready runtime.

A missing metadata key is valid first use. A corrupt existing key is not silently equivalent to first use.

## Metadata lifecycle

```ts
export const emptyRoomMeta = (): RoomMeta => ({
  version: 1,
  highWaterEpoch: 0,
  endedSessions: [],
  activeStartDecision: null,
})
```

The sync service constructor restores:

- `highWaterEpoch`;
- every ended-session epoch;
- every retained normalized end envelope;
- `activeStartDecision`.

`maxPersistedTombstones` is the single count bound used in memory and storage, and `maxRoomMetaBytes` is checked before normalization. Retain the newest entries by epoch, not insertion-map accident.

## Critical writes

Epoch decisions and tombstones are protocol safety data. Their writes are awaited:

```ts
const persistMeta = async (meta: RoomMeta) => {
  await storage.setItem(metaKey(roomScope), meta)
}
```

A failed write:

- does not advance the interactive high-water epoch;
- does not finalize termination;
- switches the novella UI to a blocking/read-only error;
- may be retried or reset explicitly.

Checkpoint writes remain best-effort because they are only UI continuity.

## Checkpoint hook

The ready child receives a non-null `roomScope: string`, so the hook keeps a simple type:

```ts
useVisualNovelCheckpoint({
  storage: StorageAdapter,
  roomScope: string,
  state: VisualNovelSessionState | null,
})
```

It validates checkpoint state structurally and semantically before showing a read-only provisional preview. Canonical state always replaces provisional state.

## Clearing

- authoritative end: clear checkpoint and latest pointer, retain RoomMeta tombstone;
- story switch or reconciliation to another session: clear losing/replaced checkpoint;
- reset local novella data: clear checkpoints and metadata only after a confirmation explaining that safety history will be forgotten locally until peers re-teach it.

## Active decision retention

`activeStartDecision` supports same-epoch recovery after reload. Update it when a start decision wins. Clear it when:

- a higher epoch installs;
- its session is tombstoned;
- metadata is reset.

The current progressed state remains in the checkpoint; the retained decision proves which session the epoch began with under the honest-peer MVP model.

## Tests

- complete RoomMeta round-trip including retained envelopes and active decision;
- corrupt metadata blocks receiver mount;
- critical write failure blocks state exposure/finalization;
- checkpoint failure only removes continuity;
- trimming uses configured limit and preserves highest epochs;
- full reload processes no envelope before metadata initialization.
