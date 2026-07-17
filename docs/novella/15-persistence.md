# 15 — Locked metadata/state transactions, comparator floors, and checkpoints

> **Revision 10 changes:** metadata and canonical state install share one lock-scoped transaction; high-water dominance is restored; current-epoch evidence never trims; floor-only recovery is durable; stale retired checkpoints are discarded.

## Keys

```text
visual-novel:v1:<roomScope>:meta
visual-novel:v1:<roomScope>:latest
visual-novel:v1:<roomScope>:<sessionId>
```

Room scope is a one-way digest of effective room identity. Never store room secrets, invite URLs, crypto keys, chat, or media.

## Bootstrap

1. derive room scope;
2. load/normalize RoomMeta;
3. load pointer/checkpoint;
4. structurally and semantically validate checkpoint;
5. classify active, authoritative-stale, or blocking contradiction;
6. clear stale pointer best-effort;
7. enforce outcome/floor/active-record consistency;
8. compute strongest complete baseline;
9. initialize canonical store or floor-only recovery;
10. mount receiver.

Malformed RoomMeta blocks. A valid checkpoint made stale by authoritative metadata does not.

## Transaction contract

```ts
metaStateTransaction.transactAndInstall(change, install)
```

Inside one room-scoped Web Lock:

1. read and validate latest stored metadata;
2. recheck protocol authorization and closed-epoch conditions;
3. apply `change(current)`;
4. increment generation;
5. validate the exact final object and byte/current-epoch bounds;
6. write metadata;
7. synchronously update the sync service’s canonical store through no-throw `install`;
8. publish generation;
9. release lock.

The returned token records generation and outcome-floor digest. No later deferred state install exists. Checkpoint writes/deletes run after the transaction and are best-effort.

A local promise executor orders transactions. External generation notifications use the same executor.

## Floor persistence

Every state exposure advances `epochOutcome.floor`, including:

- start/switch;
- progression and choice;
- restart;
- controller change;
- same/different-session reconciliation;
- recovered snapshot accepted as canonical.

This makes the floor safety metadata, not continuity data.

## Protocol mutations

- start: new high water, active outcome/floor, decision;
- progression/restart: same outcome, advanced floor;
- reconciliation: advanced/replaced outcome/floor, decision when session changes, reconciliation disposition for loser;
- open migration: append lineage entry;
- migration winner: update selected lineage record and floor;
- switch: switched disposition, next outcome/floor, clear old lineage/conflicts/recovery;
- end: ended disposition/certificate, ended outcome, clear active decision/lineage, cancel same-epoch operations;
- disposition/certificate gossip: merge exact evidence without harming another active session;
- reset: explicit confirmation only.

## Bounds and trimming

Partition records into:

- **current epoch:** never trim; validate dedicated limits and fail closed on overflow;
- **historical epochs:** canonical sort and trim newest-first within historical bounds.

Certificate trimming occurs before removal of now-unreferenced ended dispositions. High water remains at least every retained record epoch. The outcome/floor is never trimmed.

Migration lineage is current-epoch only and never trimmed.

## Checkpoints

Write a truncated canonical checkpoint and latest pointer after transaction success. A checkpoint is continuity only.

On bootstrap:

- terminally disposed, noncanonical, or older-epoch checkpoint → discard/pointer-clear best-effort;
- checkpoint above high water or impossible relative to floor → blocking contradiction;
- missing checkpoint with active outcome → floor-only exact recovery.

Cleanup failure never converts an authoritative stale checkpoint into a blocking protocol error.

## Tests

- metadata/state transaction holds lock through canonical-store install;
- newer tab cannot land between metadata write and local install;
- external generation queues after local transaction;
- every durable record epoch <= high water;
- floor advances on every canonical transition;
- current-epoch record/lineage overflow fails closed;
- historical trimming preserves certificate/disposition pairing;
- stale retired checkpoint deletion failure still boots into recovery/lobby;
- active outcome without checkpoint retains comparator floor.
