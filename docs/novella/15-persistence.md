# 15 — Locked persistence, compact transitions, proof policy, and immutable checkpoints

> **Revision 13 changes:** immutable checkpoint blobs close the stale-writer overwrite race, transition dependencies are self-contained, and capacity recovery is cause-specific.

## Keys

```text
visual-novel:v1:<roomScope>:meta
visual-novel:v1:<roomScope>:latest
visual-novel:v1:<roomScope>:checkpoint:<sessionId>:<generation>:<floorDigest>
visual-novel:v1:<roomScope>:emergency
```

Store no room secret, invite URL, chat, media, analytics, or proof-page assembly in durable storage.

## Capability and emergency state

All protocol writes and coherent reads require a room-scoped Web Lock. If unavailable, attach no installing receiver.

`emergency` is a small local storage-failure diagnostic marker. Durable protocol locks remain in RoomMeta and fit reserved headroom.

## Operational reserve

- normal metadata must remain `<= maxOperationalRoomMetaBytes`;
- reserve fits maximum durable lock plus generation update;
- mutation predicted to exceed operational limit writes only the compact lock;
- no ordinary mutation consumes reserve;
- total metadata remains `<= maxRoomMetaBytes`.

## Transaction contract

Inside one room lock:

1. read latest metadata and emergency state;
2. recheck generation, authorization, closed epoch, lock code, and capacity;
3. apply mutation;
4. increment generation;
5. validate compact transitions, current outcome dominance, JCS digests, bounds, and reserve;
6. write metadata;
7. synchronously install prevalidated canonical-store value;
8. publish generation;
9. release lock.

## Transition persistence

Persist one canonical compact transition slot per epoch. It contains no full successor state. A start-after-ended transition embeds its predecessor completed-end certificate. Historical slots remain sealed and never trim before explicit reset. Only the active high-water slot may be replaced by an authorized same-epoch different-session reconciliation winner; the same transaction canonicalizes predecessor switched evidence.

At `maxEpochTransitions`, write `capacity/transition-limit`. This lock is reset-only; no higher proof is requested because another epoch cannot fit.

## Historical evidence compaction

- current-high-water end evidence never trims;
- historical standalone ended disposition/certificate pairs may trim together;
- embedded end proof in a transition remains;
- reconciled and switched informational records compact deterministically;
- lineage clears on higher epoch;
- compaction never changes transition IDs or proof history.

## Proof pages

Proof assemblies are bounded runtime records, not persisted. A crash during assembly simply retries the exact proof. No incomplete page set mutates RoomMeta.

The sender computes pages from one coherent metadata generation. If current outcome changes before completion, receiver discards the stale proof and requests a new one.

## Immutable checkpoint publication

```text
recordKey =
  visual-novel:v1:<roomScope>:checkpoint:
  <sessionId>:<token.generation>:<token.floorDigest>

write immutable CheckpointRecord at recordKey
acquire room lock
  read latest metadata
  require token.generation == meta.generation
  require token.floorDigest == current floor digest
  require token session == current canonical session
  require stored record bytes match token/state
  publish LatestCheckpointPointer(recordKey, token)
release lock
```

Never overwrite an existing checkpoint key. Existing unequal bytes produce `storage-failure`. A stale side effect leaves only an unreferenced immutable record and cannot damage a newer pointer or record.

Garbage collection may delete unreferenced records only after a fresh lock-held pointer scan and age threshold.

## Safety recovery preflight

For recoverable capacity codes:

1. validate complete higher proof in memory;
2. lock and re-read metadata/lock;
3. deterministically compact permitted historical arrays;
4. require transition count within limit;
5. require resulting metadata within operational bytes;
6. merge transitions/current evidence;
7. clear lock and publish generation;
8. enter ended or floor-only active recovery.

`transition-limit` and `digest-collision` reject network recovery. Explicit reset clears metadata, transitions, pointers, immutable checkpoint records, emergency marker, and runtime assemblies.

## Tests

- progressed/ended outcome does not rewrite transition;
- embedded end proof survives historical compaction;
- transition-limit is reset-only;
- evidence/lineage/operational lock recovery succeeds only when fit preflight passes;
- maximum proof is paginated and never persisted partially;
- generation-10 record write after generation-11 publication cannot alter generation-11 record or pointer;
- key collision with unequal bytes enters storage failure;
- coherent bootstrap ignores unreferenced stale records.
