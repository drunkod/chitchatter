# 16 — Test matrices and failure-injection transport

> **Revision 8 changes:** adds end-certificate forwarding/dominance, delayed durable migration, bootstrap-baseline races, metadata write serialization, equal-revision same-session conflicts, and realistic crash/lifecycle queue behavior.

## Required matrices

### Validation

- alias-free normalization of every payload and persisted record;
- start/migration/digest IDs and canonical electorate;
- completed-end certificate outer holder identity independent of original sender;
- all RoomMeta cross-field contradictions;
- canonical byte ordering property across shuffled object insertion order and mocked locales.

### Bootstrap and persistence

- metadata plus checkpoint baseline load before receiver;
- conflicting same-epoch gossip queued during bootstrap cannot overwrite active decision;
- overlapping start/tombstone/migration mutations serialize and retain all safety data;
- critical write/lock failure exposes no replacement;
- room change unmounts old receiver before new digest resolves.

### Start/reconciliation

- partial commit + coordinator crash + identity-safe gossip;
- equal-revision different session and equal-revision same-session divergence;
- full semantic bytes decide independently of delivery order;
- persistence precedes `setState`;
- restored active decision is the sole gossip source.

### Migration

- first announcement installs, later better announcement supersedes;
- delay beyond any retry timer still admissible;
- reload preserves original departure record;
- end/higher epoch clears record;
- same metadata but different state content converges.

### Termination

- ACK round and duplicate original re-ACK;
- holder with changed peer ID forwards `SESSION_END_NOTICE_GOSSIP` successfully;
- certificate clears migrated/progressed exact session/epoch but not other session/higher epoch;
- persistence failure preserves state/round;
- retained certificate survives reload.

### Recovery

- overlapping request IDs coexist;
- exact target, expiry, session/epoch, conflict ID, and recovery kind enforced;
- revision-gap cannot authorize cross-session snapshot;
- bootstrap/start/migration reconciliation each use their own comparator baseline.

## Link-aware test network

Each `TestTransport` owns a `knownPeers` view. The network stores ordered links and refreshes affected views after register, unregister, link change, partition, and heal. Tests can suppress a lifecycle notification while still changing link visibility to model missed leave/join events.

```ts
crash(peerId, { preserveBuffered = false } = {}) {
  if (!preserveBuffered) {
    queue = queue.filter(item => item.from !== peerId && item.to !== peerId)
  }
  unregister(peerId)
  refreshAllViews()
}
```

Default crash drops every undelivered delivery from/to the peer. A test that intentionally models already-buffered network delivery opts into `preserveBuffered` explicitly.

`send` resolves on enqueue. Delivery is manually pumped/reordered/dropped. One-way `setLink` controls `getPeers` and receiver delivery. Lifecycle callbacks are derived from each transport's prior `knownPeers` versus refreshed visibility, with an explicit suppression option for missed-event scenarios.

`deliverPartiallyThenCrash` pumps only selected target deliveries, removes all remaining sender deliveries, then crashes the sender.

## Concrete transport requirements

- `makeAction<T extends DataPayload>` routes every delivery through network enqueue;
- receiver sets and keyed lifecycle handler maps;
- insert-before-join notification;
- disconnect delegates to network crash;
- compile-only assignment to `VisualNovelTransport` locks type compatibility.

## CI

Unit, type, lint, build, and focused E2E suites appear as status checks on implementation PRs. Documentation-only plan commits may have no runs.
