# 12 — Sync runtime, dispatch, exact recovery, and lifecycle

> **Revision 8 changes:** receiver mount waits for metadata plus checkpoint baseline, dispatch includes end-certificate gossip, recovery records are mapped and kind-specific, and room/lifecycle cleanup cannot leak prior-room state.

## Ready-runtime inputs

```ts
interface Options {
  transport: VisualNovelTransport
  initialMeta: RoomMeta
  initialCheckpoint: VisualNovelSessionState | null
  persistMetaMutation: MetaMutationAdapter
  storyCatalog: StoryCatalog
  setState: (state: VisualNovelSessionState | null) => void
  onSessionEnded: (sessionId: string) => Promise<void>
  onProtocolError: (message: string) => void
}
```

No receiver exists before all inputs are validated. The sync service seeds high water, tombstones, end certificates, active start, active migration, and boot baseline synchronously before connecting the transport receiver.

## Receive path

```ts
normalize → outer transport identity → typed gate → participation guard
→ semantic validation → exhaustive dispatch → awaited metadata mutation
→ atomic state apply → duplicate commit
```

Dispatch adds `SESSION_END_NOTICE_GOSSIP` beside start gossip and reconciliation. `reply-ended` gate results call `sendEndNoticeGossip`, not `send(originalEndEnvelope)`.

## Recovery map

```ts
const outstandingRecoveries = new Map<string, OutstandingRecovery>()
```

Creating a request inserts a bounded record before send. Snapshot handling looks up by echoed action ID, verifies exact target/context and expiry, then applies the kind rules from 08. Success deletes only that record; overlapping bootstrap and revision-gap requests do not overwrite one another.

Periodic cleanup removes expired records. Room change/unmount clears all.

## Start and migration handlers

- start commit/gossip call the same baseline-aware acceptance routine;
- reconciliation requires exact conflict ID and winning full state;
- controller change requires persisted active migration, not a timer or newly installed current controller;
- every canonical replacement persists the metadata winner before calling `setState`.

## End handlers

- original end: current-controller/exact-revision path, persist then ACK/clear;
- duplicate original: re-ACK before tombstone suppression;
- retained gossip: exact certificate dominance rules in 11;
- stale requests: send fresh holder envelope containing retained certificate.

## Request priority

1. retained completed-end certificate;
2. pending termination envelope from the original controller;
3. active start-decision gossip;
4. controller snapshot or serialized progression response.

## Peer lifecycle

Local membership events open/retry elections but never expire persistent migration authority. Joins receive current snapshot, pending end, or retained certificate as appropriate. The participation guard uses `subjectSessionId`, including embedded start and end certificate subjects.

## Cleanup

Clear request, start, retry, migration, termination, and UI timers. Remove only novella keyed handlers. On room-key change the ready runtime unmounts immediately before a new bootstrap begins; no previous room receiver remains active.
