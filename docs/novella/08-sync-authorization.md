# 08 — Sync service, gate, locked metadata, and authorization

> **Revision 9 changes:** re-ACK checks retained certificate IDs before tombstones, retired sessions are separate from end certificates, epoch outcome closes ended epochs, and storage mutations run inside the lock against latest data.

## Gate decisions

```ts
type GateDecision =
  | { kind: 'dispatch' }
  | { kind: 'drop'; reason: string }
  | { kind: 'reack-end' }
  | { kind: 'reply-ended'; certificate: CompletedEndCertificate }
  | { kind: 'reply-retired'; retirement: SessionRetirement }
```

Order after structural normalization and outer identity:

1. incoming original `SESSION_ENDED` whose action ID equals a retained certificate → `reack-end` even after reload;
2. duplicate original end → `reack-end`;
3. duplicate other action → drop;
4. exact retired session:
   - completed certificate available and request/confusion traffic → `reply-ended`;
   - switched/reconciled retirement → `reply-retired`;
   - otherwise drop;
5. start proposal at `<= highWater` → drop;
6. start decision/gossip at `< highWater` → drop;
7. start decision at `== highWater` while outcome is `ended` → drop;
8. other state traffic at `< highWater` → drop;
9. dispatch.

Replies use fresh holder envelopes. `reply-retired` sends a bounded `ERROR` such as `SESSION_RETIRED`; it never invents a completed end.

## Locked RoomMeta adapter

The mutation function—not a precomputed object—crosses the storage boundary:

```ts
interface MetaMutationAdapter {
  mutate(change: (current: RoomMeta) => RoomMeta): Promise<RoomMeta>
  readLatest(): Promise<RoomMeta>
  subscribe(listener: (meta: RoomMeta) => void): () => void
}
```

```ts
async function mutate(change) {
  return withRoomScopedLock(async () => {
    const current = validateRoomMetaOrThrow(await readStoredMeta())
    if (current.generation >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Room metadata generation exhausted')
    }
    const candidate = change(current)
    const next = validateRoomMetaOrThrow({
      ...candidate,
      generation: current.generation + 1,
    })
    await writeStoredMeta(next)
    broadcastGeneration(next.generation)
    return next
  })
}
```

The in-memory service queues calls, installs only the returned latest record, and refreshes on external-tab generation notifications. A newer external record updates gate state immediately; retirement/end of the live session forces read-only reconciliation, and a changed active outcome starts exact recovery. Every protocol mutation rechecks its preconditions inside `change(current)`.

## Exact recovery map

Store bounded records keyed by request action ID. All kinds require exact sender/target, unexpired record, expected epoch, and success-time deletion.

- revision gap: exact session, revision not behind;
- bootstrap: compare against strongest boot baseline and epoch outcome;
- start reconcile: matching conflict ID; different-session state requires matching decision;
- migration reconcile: matching active session-bound migration ID and session; incoming wins strongest migration baseline.

## Authorization summary

| Action | Authority |
| --- | --- |
| start proposal | proposer owns candidate; local coordinator; null live state; next epoch |
| start commit/gossip | valid decision; compare against strongest baseline and epoch outcome |
| reconciliation | matching conflict; complete state strictly wins |
| state snapshot | current controller or exact recovery target with kind rules |
| requests/progression | current controller, exact session/revision, no pending termination |
| session switch | current controller; exact next epoch; retire old as switched |
| original end | current controller; exact next revision; payload epoch matches state |
| end ACK | frozen recipient and exact end action |
| end gossip | holder identity; exact bound certificate dominance |
| controller change | active migration for same session; strongest migration baseline |
| control actions | reject until implemented |
