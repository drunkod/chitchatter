# 16 — Test matrices and failure-injection transport

> **Revision 9 changes:** adds direct regressions for stale start/migration baselines, closed-epoch resurrection, reload re-ACK, cross-session migration rejection, and in-lock cross-tab mutation.

## Required regressions

### Validation and metadata

- end certificate binds action, session, epoch, story ID/version;
- switched/reconciled retirement validates without certificate;
- certificate requires matching ended retirement;
- epoch outcome and active-record contradictions reject;
- canonical ordering ignores locale/insertion order.

### Start/reconciliation

- active decision rev0 + checkpoint rev10 + competing rev1 keeps rev10;
- equal-revision same-session and different-session conflicts converge;
- losing session retirement persists;
- canonical session ends, then delayed loser decision cannot install;
- different-session reconciliation requires matching decision.

### Migration

- lastApplied rev11 + current rev20 + delayed incoming rev12 keeps rev20;
- losing announcement receives migration reconciliation;
- cross-session controller change rejects;
- after start reconciliation changes session, old migration clears and absent winning controller opens a new record;
- delayed better same-session announcement remains admissible after reload.

### Termination

- dropped ACK, recipient reload, original resend re-ACKs from retained certificate ID;
- certificate epoch/story tampering rejects;
- certificate ends exact migrated/progressed session only;
- switch/reconcile retirement never sends fake end certificate;
- ended outcome blocks all same-epoch starts.

### Locked persistence

- two tabs concurrently add different retirements/certificates and preserve union;
- mutation callback runs after latest read inside Web Lock;
- external generation refreshes in-memory store;
- final generation overflow is rejected;
- critical failure exposes no state.

### Recovery and UI

- overlapping request IDs coexist;
- exact target/kind/session/epoch/conflict/migration/expiry enforced;
- room change removes receiver before new digest;
- rollback/end/retirement messages match apply mode.

## Link-aware mesh

Each test transport has a `knownPeers` view derived from directional links. Send resolves on enqueue; tests pump, reorder, or drop deliveries. Lifecycle callbacks are generated from visibility changes and may be explicitly suppressed to model a missed event.

Default crash removes every undelivered item from/to the peer. `preserveBuffered` is opt-in. `deliverPartiallyThenCrash` delivers selected targets, removes remaining sender items, then crashes.

The concrete transport routes all messages through the network, has keyed receiver/lifecycle maps, inserts before join notification, delegates disconnect to network crash, and has a compile-only `VisualNovelTransport` assignment.

## CI

Implementation PRs must show unit, type, lint, build, and focused E2E checks. Documentation-only plan commits may have no workflow run.
