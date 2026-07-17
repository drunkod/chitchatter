# 16 — Regression, property, and failure-injection matrices

> **Revision 11 changes:** adds digest-order equivalence, successor notice coherence, ended-certificate terminality, descriptor rebasing, stable-generation bootstrap, disposition upsert, global safety-lock, Web Lock capability, and lost-notification recovery tests.

## Validation and digest

- exact canonical semantic object excludes only top-level `updatedAt`;
- object keys sort by unsigned UTF-8 bytes;
- exact SHA-256 domain separator and lowercase hex fixture;
- full-state comparator and floor comparator return identical ordering;
- digest collision test hook enters safety lock;
- same session/epoch different story rejects;
- both active-origin variants normalize alias-free;
- successor known state exactly matches advertised floor.

## Start, reconciliation, switch

- rev0 origin + rev10 floor/checkpoint + rev1 competitor keeps rev10;
- former loser progresses farther and becomes canonical;
- opposite delivery orders converge;
- exact conflict descriptor applies;
- descriptor made at rev10 arrives after receiver rev11 and rebases;
- stale incoming loses and receives fresh descriptor/latest state;
- repeated stale envelope does not loop on old conflict ID;
- repeated logical reconciliation consumes one disposition slot;
- different-session reconcile accepts start or session-started origin;
- switched notice arriving before successor state raises high water and enters floor-only recovery;
- switched notice without successor rejects.

## Migration

- sequential two/three departures retain earlier IDs;
- delayed earlier-lineage stronger state converges;
- migration descriptor rev10→rev11 rebases;
- weaker announcement receives fresh descriptor;
- lineage overflow enters safety lock without trimming;
- generation refresh occurs before advertisements;
- cross-session controller change rejects;
- end/higher epoch clears lineage.

## Termination/disposition

- dropped ACK + reload + original resend re-ACKs;
- ended disposition without certificate is nonterminal and not persisted via retirement gossip;
- certificate tampering rejects;
- end cancels every same-epoch recovery/conflict/install path;
- switched successor notice merges coherently;
- reconciled notice does not hide later full-state evidence;
- concurrent duplicate disposition merge is deterministic;
- certificate/disposition overflow enters room-wide safety lock.

## Cross-tab/bootstrap

- metadata changes between initial meta and checkpoint reads → retry, not contradiction;
- stable snapshot checkpoint above same-generation floor blocks;
- tab A cannot install after tab B newer generation;
- store update happens before lock release;
- external notification queues behind local transaction;
- crash after metadata write before publish repaired on focus;
- stale tab refreshes before controller/progression send;
- Web Lock unavailable/denied performs no protocol write or state install;
- stale checkpoint pointer deletion failure remains nonblocking.

## Safety-lock behavior

- capacity/lock/digest/storage lock disables all novella controls and installs;
- chat, media, screen share, and files remain usable;
- same-epoch network state cannot clear lock;
- verified higher epoch clears only allowed lock kinds by explicit rule;
- reset requires user confirmation and clears metadata/checkpoints.

## Link-aware mesh

Each transport owns directional `knownPeers`. Send resolves on enqueue. Tests pump, reorder, delay, duplicate, or drop deliveries. Lifecycle notifications derive from view changes and may be suppressed. Default crash removes all undelivered items from/to the peer; buffered delivery is explicit opt-in.

## Property/fuzz tests

- comparator totality/transitivity over validated state+digest wrappers;
- floor/full-state order equivalence;
- conflict ID symmetry and rebase convergence;
- arbitrary delivery order converges while active;
- no trace installs after ended outcome;
- every exposed state equals persisted floor digest;
- disposition merge is associative/commutative/idempotent for valid records;
- arbitrary metadata interleavings preserve invariants or enter safety lock.

## CI

Implementation PRs must show unit, type, lint, build, and focused E2E checks. Documentation-only plan commits may have no workflow run.
