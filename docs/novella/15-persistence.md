# 15 — Checkpoints and serialized room safety metadata

> **Revision 8 changes:** RoomMeta persists migration authority, enforces cross-field invariants, serializes mutations from the latest value, and bootstrap loads the checkpoint baseline before receiver attachment.

## Keys

```text
visual-novel:v1:<roomScope>:meta        → RoomMeta
visual-novel:v1:<roomScope>:latest      → checkpoint session ID
visual-novel:v1:<roomScope>:<sessionId> → truncated checkpoint state
```

Room scope is an asynchronous one-way digest of the effective room identity. Never store room secrets, invite URLs, crypto keys, transport metadata, chat, or media.

## Bootstrap order

1. derive room scope;
2. read and normalize RoomMeta;
3. read pointer and checkpoint;
4. structurally and semantically validate checkpoint and active record states;
5. enforce metadata/checkpoint consistency;
6. mount ready runtime and only then attach receiver.

Malformed existing metadata or contradictory checkpoint safety state shows blocking reset/retry UI. It never silently becomes empty metadata.

## Metadata mutation adapter

Every mutation executes through one room-scoped queue/lock:

```ts
mutateMeta(async current => {
  const next = protocolMutation(current)
  return validateRoomMetaOrThrow({
    ...next,
    generation: current.generation + 1,
  })
})
```

Implementation reads the latest stored record inside the room-scoped Web Lock, validates it, merges the mutation, writes, then updates the in-memory service snapshot. Within one runtime, a promise queue preserves order. No handler captures and later writes a stale metadata object.

If required lock/write semantics are unavailable or fail, novella safety mutations are blocked/read-only. Checkpoint writes remain best-effort because they are UI continuity only.

## Protocol mutation rules

- start winner: raise high water, store active decision, clear older migration;
- open migration: store active migration for current high-water session;
- migration winner: update active migration last state;
- switch/higher epoch: tombstone replaced session as required, raise high water, clear older active records;
- completed end: add/replace certificate, canonical-sort/trim tombstones, clear matching active records;
- reset: explicit confirmation clears metadata and checkpoints.

## Checkpoints

Write `toSnapshotState(state)` and latest pointer after canonical state is exposed. On failure, continuity is lost but protocol safety remains. Clear losing/replaced/ended checkpoints. A provisional checkpoint never grants controller authority.

## Cross-field validation

Require the complete invariants from 02/03 plus:

- checkpoint session not tombstoned;
- checkpoint epoch <= high water;
- if checkpoint epoch equals active decision/migration epoch, session identities agree or bootstrap blocks for explicit recovery;
- generation is a safe non-negative integer;
- tombstone trimming keeps greatest `(epoch, sessionId)` entries deterministically.

## Tests

- serialized overlapping mutations preserve union of tombstones and newest records;
- lock/write failure exposes no new state;
- full metadata/checkpoint/active-migration round-trip;
- contradictory metadata or checkpoint blocks ready runtime;
- losing checkpoint clears after reconciliation/end certificate;
- multi-tab lock test cannot overwrite newer safety data.
