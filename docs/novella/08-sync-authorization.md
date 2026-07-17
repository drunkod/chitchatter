# 08 — Sync service, typed gate, serialized metadata, and authorization

> **Revision 8 changes:** adds identity-safe end-certificate gating, a serialized RoomMeta mutation store, one authoritative source for active records, and complete kind-specific recovery authorization.

## Subject helpers and gate

`subjectState` returns embedded state for start, reconcile, snapshot, switch, restart, election, and controller-change actions. `subjectSessionId` additionally returns `ended.sessionId` for `SESSION_END_NOTICE_GOSSIP`.

```ts
export type GateDecision =
  | { kind: 'dispatch' }
  | { kind: 'drop'; reason: string }
  | { kind: 'reack-end' }
  | { kind: 'reply-ended'; ended: PersistedEndNotice }
```

Gate order:

1. duplicate original `SESSION_ENDED` → `reack-end` before tombstone suppression;
2. duplicate other action → drop;
3. tombstoned request/progression → `reply-ended` certificate;
4. other tombstoned traffic → drop, except a new `SESSION_END_NOTICE_GOSSIP` may dispatch when its exact certificate is not already retained;
5. proposal at `<= highWater` → drop;
6. decision/gossip at `< highWater` → drop;
7. other state traffic at `< highWater` → drop;
8. dispatch.

`reply-ended` sends a fresh `SESSION_END_NOTICE_GOSSIP`, never the original end envelope.

## Serialized metadata store

All safety mutations go through one queue and read the latest validated value inside the queue:

```ts
class RoomMetaStore {
  private tail = Promise.resolve()
  constructor(private current: RoomMeta, private write: (meta: RoomMeta) => Promise<void>) {}

  mutate(change: (current: RoomMeta) => RoomMeta): Promise<RoomMeta> {
    const run = this.tail.then(async () => {
      const next = validateRoomMetaOrThrow(change(this.current))
      const withGeneration = { ...next, generation: this.current.generation + 1 }
      await this.write(withGeneration)
      this.current = withGeneration
      return withGeneration
    })
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  snapshot = () => this.current
}
```

Handlers never build independent stale metadata snapshots. A failed write leaves state unchanged/read-only. The service exposes authoritative getters for active start decision, migration record, retained ends, and high water; React does not mirror them in separate refs.

For multiple same-origin tabs, the persistence adapter performs the queued read/merge/write under a room-scoped Web Lock when available. If an existing browser cannot provide the required lock semantics, novella safety writes are blocked rather than pretending cross-tab durability.

## Exact recovery map

Store at most `maxOutstandingRecoveries` records in a map keyed by request action ID. Remove on success, cancellation, expiry, room change, or unmount.

Authorization by kind:

- `revision-gap`: exact target, request ID, session ID, epoch, revision not behind;
- `bootstrap`: exact target, epoch >= high water, then compare against boot baseline/active decision;
- `start-reconcile`: matching open `StartConflict.conflictId`, same epoch, incoming state wins comparator;
- `migration-reconcile`: matching active migration ID/session/epoch, incoming state wins comparator;
- every kind: `now <= expiresAt` and exact transport sender.

## Authorization matrix

| Action | Required authority/result |
| --- | --- |
| `START_PROPOSE` | proposer owns candidate; self is local coordinator; null live state; exact next epoch |
| `START_COMMITTED` | outer sender is decision coordinator and acceptable coordinator; compare/install |
| `START_DECISION_GOSSIP` | any honest holder; embedded decision valid; compare/install |
| `SESSION_RECONCILE` | matching recorded conflict; complete state strictly wins |
| `STATE_REQUEST` | answer with end certificate, held decision, or exact controller snapshot |
| `STATE_SNAPSHOT` | current controller or exact outstanding target; kind-specific rules above |
| requests | self current controller; exact session/revision; no pending termination |
| progression | outer sender current controller; exact next revision; engine replay matches |
| `SESSION_STARTED` | current controller; revision 0; exact `epoch + 1` |
| original `SESSION_ENDED` | current controller; exact next revision; persist tombstone then ack/clear |
| `SESSION_END_ACK` | frozen recipient and exact pending action ID |
| `SESSION_END_NOTICE_GOSSIP` | any holder; normalized certificate; exact session/epoch dominance rules in 11 |
| election advertise | local round member to local winner; round/epoch match |
| controller changed | winner of canonical electorate; active persisted migration; state wins comparator |
| control actions | reject until implemented |

The comparator from 01 is the only distributed state ordering.
