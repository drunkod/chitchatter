# 12 — Sync runtime, dispatch, coherent recovery, and lifecycle refresh

> **Revision 11 changes:** runtime boots from a stable-generation snapshot, supports conflict rebasing, refreshes generations on focus and before actions, and separates observe-only capability failure from installing operation.

## Ready inputs

```ts
interface Options {
  transport: VisualNovelTransport
  bootstrap: ConsistentBootstrapSnapshot
  metaStateTransaction: MetaStateTransaction
  storyCatalog: StoryCatalog
  canonicalStore: CanonicalVisualNovelStore
  onProtocolError: (message: string) => void
}
```

No installing receiver exists before coherent bootstrap classification, stories, floor, origin, and strongest full-state baseline are ready.

## Canonical store

The sync service owns canonical state. `transactAndInstall` updates metadata and store synchronously under the room lock. React uses `useSyncExternalStore`. No handler retains deferred `setState` after persistence.

## Receive path

```text
normalize → outer identity → gate → participation
→ semantic validation/digest → authorization or rebase
→ lock-scoped metadata/store transaction
→ duplicate commit → checkpoint side effects
```

Dispatch is exhaustive for all 22 actions.

## Recovery map

Records are keyed by action ID and bind target, kind, epoch/session, expected floor digest, conflict/migration identity, and expiry.

At response time:

- refresh/re-read latest metadata inside executor;
- reject closed/safety-locked outcome;
- if floor changed, apply kind-specific rebase rather than trusting stale expected floor;
- success removes only that request;
- end/higher epoch cancels all matching records.

## Conflict handling

Exact descriptor and stale descriptor share one handler. Stale descriptor does not fail merely because local state advanced. It compares incoming with latest state/floor and emits/applies a fresh descriptor.

## Request response priority

1. completed end certificate;
2. switched/older-epoch disposition with successor evidence;
3. active-epoch reconciled history plus current canonical full-state evidence when recovery requested;
4. pending original termination;
5. active origin/start decision gossip;
6. controller snapshot/progression response.

A disposition never hides stronger recovery evidence.

## External generation repair

Metadata notifications queue on the same executor. Additionally call `ensureLatestGeneration()`:

- when document becomes visible;
- when window regains focus;
- before every novella state-changing UI action or controller send;
- before opening migration/start rounds.

If generation advanced:

- ended/switched live session → null/recovery transition;
- changed outcome or floor above local state → read-only exact recovery;
- safety lock → persistent error phase;
- older/equal generation → ignore.

This repairs a sibling tab crash after durable write but before generation publication.

## Lock capability

If room-scoped Web Locks are unavailable/denied, do not attach an installing receiver. Render a read-only capability state and leave chat/media/files active. Never use an unlocked mutation fallback.

## Lifecycle

Peer events append/retry migration lineage but never expire it. Joins receive snapshot, pending end, end certificate, or disposition plus successor as applicable. Cleanup removes only novella handlers/timers, closes subscriptions, and invalidates pending operations. Room-key change unmounts old runtime before new bootstrap.
