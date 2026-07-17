# 16 — Regression matrices and failure-injection transport

> **Revision 10 changes:** adds regressions for nonterminal reconciliation evidence, universal epoch closure, high-water history, generation-atomic install, migration lineage, symmetric conflicts, floor-only recovery, current-epoch bounds, story identity, and stale checkpoint cleanup.

## Required regressions

### Validation and metadata

- every disposition/certificate/lineage/floor epoch is <= high water;
- high water 0 rejects all historical records;
- certificate binds action/session/epoch/story;
- switched/reconciled disposition validates without certificate;
- same session/epoch with different story ID/version rejects;
- symmetric conflict descriptor validates from either state order;
- current-epoch bounds reject rather than trim;
- canonical ordering ignores locale/insertion order.

### Start and reconciliation

- rev0 decision + rev10 checkpoint/floor + competing rev1 keeps rev10;
- reconciled loser later progresses beyond winner and can become canonical;
- exact same scenario with deliveries reversed converges identically;
- first reconcile envelope creates conflict record;
- opposite peers derive the same conflict ID;
- different-session reconcile requires matching decision;
- same-session different story/version rejects;
- ended epoch rejects start, snapshot, reconcile, restart, and queued recovery.

### Migration

- lastApplied rev11 + current/floor rev20 + incoming rev12 keeps rev20;
- two and three sequential departures retain earlier lineage IDs;
- delayed earlier-lineage stronger announcement converges;
- losing announcement receives symmetric migration reconcile;
- cross-session controller change rejects;
- lineage overflow fails closed without trimming;
- reload retains lineage.

### Termination/disposition

- dropped ACK + reload + original resend re-ACKs;
- certificate tampering rejects;
- end cancels outstanding same-epoch recovery/conflicts;
- ended exact session clears, other session/higher epoch does not;
- structured switched/reconciled disposition gossips exact record;
- reconciled disposition does not suppress later full-state evidence;
- current-epoch disposition/certificate overflow fails closed.

### Cross-tab transaction

- tab A transaction cannot install after tab B newer generation;
- canonical store update occurs before lock release;
- external generation queues behind local transaction;
- write/install failure exposes no partial state;
- concurrent tabs preserve union of historical records.

### Bootstrap/checkpoint

- active outcome with no checkpoint/decision/lineage state enters floor-only recovery;
- state below floor rejects; equal digest accepts; higher authorized state advances;
- retired stale checkpoint pointer deletion failure still boots;
- checkpoint above high water blocks;
- rapid room change removes old receiver/store.

## Link-aware mesh

Each `TestTransport` owns a `knownPeers` view from directional links. Send resolves on enqueue. Tests pump, reorder, delay, duplicate, or drop deliveries. Lifecycle callbacks derive from view changes and can be suppressed.

Default crash removes undelivered items from/to the peer. `preserveBuffered` is opt-in. `deliverPartiallyThenCrash` delivers selected targets, removes remaining sender items, then crashes.

The concrete transport routes all action delivery through the network, has keyed receiver/lifecycle maps, inserts before join notification, delegates disconnect to crash, and includes a compile-only `VisualNovelTransport` assignment.

## Property/fuzz tests

- comparator transitivity and totality for semantically valid states;
- conflict ID symmetry;
- delivery-order convergence across start/migration/reconcile traces;
- arbitrary metadata mutation interleavings preserve invariants;
- no trace installs state after an ended outcome at the same epoch;
- every exposed state digest equals persisted outcome floor.

## CI

Implementation PRs must show unit, type, lint, build, and focused E2E checks. Documentation-only plan commits may have no workflow run.
