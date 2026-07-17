# 12 — Sync runtime, dispatch, recovery, and lifecycle

> **Revision 10 changes:** the runtime uses a canonical external store updated inside metadata transactions, dispatch covers retirement gossip, and end/outcome changes invalidate all same-epoch recovery.

## Ready inputs

```ts
interface Options {
  transport: VisualNovelTransport
  initialMeta: RoomMeta
  initialCheckpoint: VisualNovelSessionState | null
  metaStateTransaction: MetaStateTransaction
  storyCatalog: StoryCatalog
  canonicalStore: CanonicalVisualNovelStore
  onProtocolError: (message: string) => void
}
```

No receiver exists before metadata, checkpoint classification, stories, outcome floor, and strongest full-state baseline are ready.

## Canonical store

The sync service, not React, owns canonical state. `transactAndInstall` updates metadata and this store synchronously while holding the room lock. React subscribes through `useSyncExternalStore`.

No async handler keeps a deferred `setState` callback after metadata persistence.

## Receive path

```text
normalize → outer identity → typed gate → participation
→ semantic validation → action authorization
→ lock-scoped metadata/state transaction
→ duplicate commit → best-effort checkpoint side effects
```

Dispatch is exhaustive for every action, including `SESSION_RETIREMENT_GOSSIP`.

## Recovery map

Requests are bounded and keyed by action ID. Validate echoed ID, exact sender/target, expiry, kind, epoch/session, conflict/migration identity, floor, and closed outcome.

When metadata changes to an ended outcome or higher epoch:

- synchronously invalidate matching recovery records;
- close matching conflict records;
- ignore any already queued handler at its inside-transaction recheck.

## Handler rules

- start commit/gossip compares current/checkpoint/decision/lineage full states and floor;
- reconciliation verifies a symmetric descriptor and may create its conflict on first contact;
- migration selects any retained lineage ID;
- original end re-ACK checks certificate ID before disposition suppression;
- end gossip applies exact dominance;
- retirement gossip persists exact disposition with terminality rules;
- every full-state install uses `transactAndInstall`.

## Request response priority

1. completed-end certificate for exact session;
2. terminal switched/older-epoch disposition;
3. active-epoch reconciled disposition plus, when requested for recovery, current canonical state evidence;
4. pending original termination;
5. active start decision gossip;
6. controller snapshot/progression response.

A reconciliation disposition must not hide stronger full-state recovery evidence.

## External-tab generations

Metadata subscriptions queue a refresh through the same service executor. If the new generation:

- ends or switches the live session, perform a local canonical-store transaction to null/reconcile;
- changes canonical session or advances floor beyond local state, enter read-only recovery;
- is older/equal, ignore.

## Lifecycle

Peer events append/retry migration lineage but never expire it. After start reconciliation changes session, clear old lineage and open a new record only if the winning controller is absent.

Joins receive the appropriate snapshot, pending end, certificate, or disposition. Cleanup removes only novella handlers/timers and invalidates pending operations. Room-key change unmounts the ready runtime before new bootstrap.
