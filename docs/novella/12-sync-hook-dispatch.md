# 12 — Sync runtime, dispatch, recovery, and lifecycle

> **Revision 9 changes:** dispatch distinguishes retirement from completed end, seeds the strongest boot baseline, and rechecks protocol mutations against latest locked metadata.

## Ready inputs

```ts
interface Options {
  transport: VisualNovelTransport
  initialMeta: RoomMeta
  initialCheckpoint: VisualNovelSessionState | null
  metaAdapter: MetaMutationAdapter
  storyCatalog: StoryCatalog
  setState: (state: VisualNovelSessionState | null, mode: ApplyMode) => void
  onSessionEnded: (sessionId: string) => Promise<void>
  onProtocolError: (message: string) => void
}
```

No receiver exists before metadata/checkpoint/story validation. The service seeds high water, outcome, retirements, certificates, active records, and strongest boot baseline synchronously.

## Receive path

```text
normalize → outer identity → gate → participation
→ semantic validation → exhaustive dispatch
→ locked metadata mutation → atomic state apply → duplicate commit
```

Dispatch includes start gossip, reconciliation, original end, end gossip, ACK, and retirement replies.

## Recovery map

Requests are bounded and keyed by action ID. Handler validates echoed ID, exact sender/target, expiry, kind, epoch/session, conflict or migration ID, and comparator baseline. Success removes only that record; room change/unmount removes all.

## Handler rules

- start commit/gossip uses live/checkpoint/decision strongest baseline;
- reconciliation requires exact conflict and optional decision for session change;
- migration requires exact session-bound active migration and strongest current/migration state;
- original end re-ACK checks retained certificate ID before tombstone suppression;
- end gossip applies exact dominance;
- retired without completed end returns bounded `SESSION_RETIRED` error;
- all state replacements persist metadata first.

## Request response priority

1. completed-end certificate for exact session;
2. retirement error for switched/reconciled session;
3. pending original termination envelope;
4. active start decision gossip;
5. controller snapshot/progression response.

## Lifecycle

Peer events may open/retry elections but never expire authorization. After start reconciliation installs another session, clear old migration and open a new one only if the winning controller is absent. Joins receive the appropriate snapshot, pending end, certificate, or retirement response.

Cleanup removes only novella handlers/timers. Room-key change unmounts the ready runtime before new bootstrap.
