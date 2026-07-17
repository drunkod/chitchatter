# 15 — Locked metadata/state transactions and coherent bootstrap persistence

> **Revision 11 changes:** specifies a stable-generation bootstrap read, exact digest persistence, successor merge, deterministic disposition upsert, Web Lock capability failure, and repair for lost generation notifications.

## Keys

```text
visual-novel:v1:<roomScope>:meta
visual-novel:v1:<roomScope>:latest
visual-novel:v1:<roomScope>:<sessionId>
```

Room scope is a one-way digest of effective room identity. Never store room secrets, invite URLs, crypto keys, chat, media, or analytics.

## Required locking capability

All protocol metadata writes and consistent bootstrap reads require a room-scoped Web Lock. If `navigator.locks` is unavailable, denied, or fails capability probing:

- set runtime `lock-unavailable` safety state;
- do not perform unlocked writes;
- do not install network state;
- keep unrelated room features active.

## Stable-generation bootstrap

Preferred algorithm:

```text
open/buffer generation notifications
acquire room Web Lock
  read and validate RoomMeta
  read latest pointer and checkpoint blob
  return one ConsistentBootstrapSnapshot(meta.generation)
release lock
initialize store/subscription
re-read latest generation
retry whole snapshot if generation changed
attach receiver
```

An implementation unable to hold the read lock across metadata and checkpoint reads must use an optimistic loop: read meta generation, read pointer/checkpoint, re-read meta, retry if generation differs. Never declare an above-floor/high-water contradiction from mixed generations.

## Transaction contract

Inside one room lock:

1. read/validate latest metadata;
2. recheck generation freshness, authorization, closed epoch, safety lock, and capacity;
3. apply mutation callback;
4. increment generation safely;
5. validate final object, exact SHA-256 digests, byte/current-epoch bounds;
6. write metadata;
7. synchronously update canonical store through a prevalidated no-throw install value;
8. publish generation;
9. release lock.

If an impossible post-write local-store failure occurs, enter storage-failure safety state and reload canonical state from persisted metadata; never continue controls.

## Floor and origin persistence

Every canonical state exposure advances outcome floor using the exact Revision 11 digest. Start/switch/different-session reconciliation also updates `activeOrigin`. End clears origin but preserves final floor.

## Disposition upsert

Canonical key is `(epoch, sessionId, reason)`.

- ended/switched exact duplicate: idempotent;
- ended/switched conflicting evidence: block metadata as contradictory;
- reconciled duplicate: keep bytewise-minimum conflict ID;
- sort by epoch, session ID, reason, evidence ID;
- never append repeated logical observations.

## Successor merge

For switched gossip, one transaction validates successor origin/outcome, raises high water, installs `activeOrigin`, merges disposition, clears obsolete lineage/conflicts/recovery, and either installs exact-floor known state or stores null canonical state for floor-only recovery.

Standalone switched disposition mutation is forbidden when receiver still has that session as active outcome.

## Bounds and safety lock

Partition historical and current-epoch records. Historical records trim deterministically below high water. Current-epoch dispositions, certificates, conflicts, and lineage never trim.

On current-epoch overflow:

- do not drop old evidence;
- atomically set capacity safety lock when possible;
- reject new installs and outgoing state changes;
- allow only verified higher-epoch successor recovery or explicit reset;
- preserve chat/media/file behavior.

## Lost notification repair

Broadcast generation after successful install, but safety does not depend on notification delivery. Re-read latest generation on focus, visibility, before every state-changing command/send, and before start/migration rounds. Inbound transactions always read latest under lock.

## Checkpoints

Checkpoint is best-effort continuity only and is written after transaction. Stable bootstrap classifies it against same-generation metadata. Authoritative-stale pointer deletion failure remains nonblocking. Missing active checkpoint enters floor-only recovery.

## Tests

- metadata/checkpoint mixed-generation race retries;
- write/store install remains lock-scoped;
- exact digest persists and comparator matches full-state order;
- switched successor merge from stale active peer;
- deterministic disposition upsert under concurrent tabs;
- current-epoch overflow enters safety lock;
- Web Lock unavailable/denied never writes;
- crash after write before publish repaired on focus/action;
- stale checkpoint cleanup failure still boots;
- historical trimming preserves ended disposition/certificate pair.
