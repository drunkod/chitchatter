# 08 — Sync service, gate, transactions, recovery, and conflict rebasing

> **Revision 11 changes:** fixes terminality, carries switched successor evidence, defines stale-descriptor rebasing, adds coherent bootstrap/freshness APIs, and forbids unsafe operation without Web Locks.

## Gate decisions

```ts
type GateDecision =
  | { kind: 'dispatch' }
  | { kind: 'drop'; reason: string }
  | { kind: 'reack-end' }
  | { kind: 'reply-ended'; certificate: CompletedEndCertificate }
  | { kind: 'reply-disposed'; disposition: SessionDisposition; successor: SuccessorEvidence | null }
```

Order after normalization and outer identity:

1. original end action ID matching retained certificate → `reack-end`;
2. duplicate original end → `reack-end`;
3. duplicate other action → drop;
4. exact terminal disposition:
   - ended with certificate → `reply-ended`;
   - switched/older epoch → `reply-disposed` with successor evidence when the receiver may still be stale;
5. active-epoch reconciled disposition:
   - request/progression confusion may receive informational disposition;
   - complete-state evidence continues to authorization;
6. stale proposal/epoch checks;
7. ended high-water state-install action → drop;
8. safety lock → reject every state-installing action;
9. dispatch.

An ended disposition without certificate is never terminal and is not accepted through retirement gossip.

## State-installing set

Central closed/safety-lock guards cover start decision/gossip, reconcile, snapshot, session-started, restart, controller change, and every progression event that installs derived state. They run at gate, authorization, and inside transaction.

## Transaction and bootstrap API

```ts
interface MetaStateTransaction {
  transactAndInstall<T>(
    change: (current: RoomMeta) => { meta: RoomMeta; value: T },
    install: (value: T, token: AppliedGenerationToken) => void,
  ): Promise<AppliedGenerationToken>

  mutate(change: (current: RoomMeta) => RoomMeta): Promise<RoomMeta>
  readConsistentBootstrap(roomScope: string): Promise<ConsistentBootstrapSnapshot>
  ensureLatestGeneration(): Promise<RoomMeta>
  subscribe(listener: (meta: RoomMeta) => void): () => void
}
```

Critical methods require a room-scoped Web Lock. If unavailable/denied, set `lock-unavailable` safety state and do not attach an installing receiver or perform writes. Never fall back to unlocked IndexedDB/localStorage mutation.

`transactAndInstall` holds the lock through metadata write and synchronous canonical-store install. Checkpoint side effects happen afterward.

## Conflict authorization and rebasing

For `SESSION_RECONCILE`:

1. validate incoming state, origin, descriptor syntax, kind, epoch, session pair, and optional lineage ID;
2. require incoming digest to be one descriptor digest;
3. get latest complete baseline and floor inside the transaction;
4. if baseline digest equals the other descriptor digest, process exact descriptor;
5. otherwise treat descriptor as stale correlation:
   - compare incoming against latest baseline/floor;
   - if incoming wins, derive a new descriptor from incoming/latest and apply atomically;
   - if incoming loses, reply with latest state and a newly derived descriptor;
   - if equal, commit idempotently;
6. different-session incoming still requires valid origin; migration kind still requires retained lineage ID.

A stale descriptor never permanently rejects valid complete-state evidence.

## Recovery authorization

Records bind exact target, request ID, kind, epoch/session, expected floor digest, optional conflict/migration ID, and expiry.

- revision gap: exact canonical session and not below latest floor;
- bootstrap: exact outcome session unless authorized different-session reconciliation;
- start reconcile: exact or rebasable descriptor plus incoming origin when session changes;
- migration reconcile: retained lineage ID and exact/rebasable same-session descriptor.

Outcome end/higher epoch cancels matching recovery/conflict records synchronously.

## Authorization summary

| Action | Required authority |
| --- | --- |
| start proposal | proposer owns revision-0 candidate; local coordinator; next epoch |
| start commit/gossip | valid decision; active/unclosed outcome; compare digest floor/current state |
| reconcile | valid incoming state/origin; exact or rebased descriptor; incoming wins |
| snapshot | current controller or exact recovery target; generation/floor/closed checks |
| requests/progression | current controller; exact session/revision; fresh generation; no termination |
| switch/session started | current controller; exact next epoch; create successor origin/outcome |
| original end | current controller; exact next revision; payload epoch |
| end ACK | frozen recipient and exact end action |
| end gossip | holder identity; exact certificate |
| retirement gossip | holder identity; ended forbidden; switched requires successor evidence |
| controller change | retained migration ID; same session/story; exact/rebased comparator |
| control actions | reject until implemented |
