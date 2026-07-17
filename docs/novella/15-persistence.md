# 15 — Locked persistence, transition chains, reserves, and checkpoint fencing

> **Revision 12 changes:** retains one transition certificate per epoch, reserves durable lock headroom, fences latest checkpoint publication by generation, and defines emergency/bootstrap behavior.

## Keys

```text
visual-novel:v1:<roomScope>:meta
visual-novel:v1:<roomScope>:latest
visual-novel:v1:<roomScope>:<sessionId>
visual-novel:v1:<roomScope>:emergency
```

Room scope is a one-way digest of room identity. Store no room secrets, invite URLs, chat, media, or analytics.

## Capability and emergency state

All protocol writes and coherent reads require a room-scoped Web Lock. If unavailable, do not attach an installing receiver.

`emergency` is a tiny fixed record for local storage-failure diagnostics only. Durable protocol locks remain in RoomMeta and are guaranteed by reserved metadata headroom. Bootstrap reads emergency state before enabling controls.

## Operational reserve

- normal metadata must be `<= maxOperationalRoomMetaBytes`;
- the remaining reserve fits the maximum encoded `DurableSafetyLock`, generation increment, and envelope overhead;
- when a normal mutation would exceed operational limit, write only the compact capacity lock using the reserve;
- no normal mutation may consume reserve space;
- total metadata must remain `<= maxRoomMetaBytes`.

## Coherent bootstrap

Preferred algorithm under room lock:

```text
read emergency marker
read/validate RoomMeta
read latest pointer
read referenced checkpoint
return one generation-tagged snapshot
```

After subscription initialization, re-read generation and retry if changed. An optimistic double-read fallback is allowed only if lock-held reads are impossible; unlocked writes remain forbidden.

## Transaction contract

Inside one room lock:

1. read latest metadata and emergency state;
2. recheck generation, authorization, closed epoch, lock, and capacity;
3. apply mutation;
4. increment generation;
5. validate transitions, RFC 8785 digests, bounds, and reserve policy;
6. write metadata;
7. synchronously install prevalidated canonical-store value;
8. publish generation;
9. release lock.

## Epoch transitions

Persist exactly one contiguous transition certificate per epoch. They are safety/provenance records and never trim before explicit reset. If `maxEpochTransitions` or operational bytes are reached, enter capacity lock. This retained chain allows stale-peer recovery even after dispositions/certificates compact.

## Evidence bounds

- current-epoch dispositions/certificates/lineage never trim;
- historical dispositions/certificates may trim deterministically while preserving retained pairs;
- transition certificates never trim;
- capacity overflow never discards existing evidence.

## Checkpoint publication

```text
write CheckpointRecord(session blob)
acquire room lock
  read latest meta
  require token.generation == meta.generation
  require token.floorDigest == meta.epochOutcome.floor.stateDigest
  require state session == current canonical session
  replace latest pointer with token-tagged pointer
release lock
```

If any condition fails, leave the blob unreferenced and optionally garbage-collect later. An old side effect cannot overwrite a newer latest pointer.

## Safety recovery

Capacity recovery transaction requires a validated transition chain ending strictly above `lockedAtEpoch`. It clears the lock only while installing the higher outcome/origin/evidence. Digest-collision lock never clears remotely. Runtime capability/storage states require local repair and a new coherent bootstrap.

## Tests

- operational byte limit leaves enough room for durable capacity lock;
- A→B→C transition records survive reload;
- stale peer recovers after historical disposition trim;
- generation-10 checkpoint cannot replace generation-11 pointer;
- mixed-generation bootstrap retries;
- lock-unavailable does no writes;
- storage failure reads emergency state before controls;
- historical evidence trimming preserves end pairs;
- reset clears transitions, evidence, checkpoints, and locks explicitly.
