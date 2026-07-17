# 16 — Regression, property, and failure-injection matrices

> **Revision 12 changes:** adds exact RFC 8785 fixtures, multi-hop transition recovery, safety-lock recovery policy, lineage-bound advertisements, stale-peer supersession after trimming, and checkpoint token fencing.

## Canonicalization and validation

- RFC 8785 fixtures for property order, control escaping, non-ASCII, lone-surrogate rejection, `-0`, exponent boundaries, and shortest numbers;
- browser and Node canonical bytes/digest equality;
- full-state/floor order equivalence;
- digest collision hook enters durable lock;
- transition ID/action/state/predecessor mix-and-match rejects;
- contiguous transition array required through high water.

## Start, transition, reconciliation

- initial and start-after-ended transition certificates;
- A→B→C stale-A recovery;
- A→B then B ended stale-A recovery;
- delayed old successor evidence at peer already beyond it is idempotent/current-wins;
- exact descriptor and rev10→rev11 rebase;
- complete-state local winner and floor-only local winner responses;
- repeated logical reconciliation consumes one disposition slot;
- former loser later wins;
- same-session changed story rejects.

## Migration

- two and three lineage records retain earlier authority;
- interleaved advertisements select exact migration IDs;
- missing/wrong advertisement migration ID rejects;
- departed controller rejoins before delayed earlier-lineage announcement;
- stronger delayed state converges despite rejoin;
- migration rebase with full and floor-only receiver;
- lineage overflow persists capacity lock.

## Termination and supersession

- dropped ACK/reload/resend re-ACK;
- ended without certificate never terminal;
- certificate binding/tampering;
- every below-high-water message receives supersession evidence;
- exact disposition trimmed plus missed lifecycle callback still converges;
- active and ended current-outcome supersession responses;
- transition-capacity and certificate-byte overflow enter durable lock.

## Safety-lock matrix

- capacity lock accepts strictly higher verified transition chain and rejects same/lower epoch;
- digest-collision lock rejects all remote recovery;
- lock-unavailable clears only after successful reprobe/bootstrap;
- storage-failure clears only after local repair/bootstrap;
- generic gate blocks installs while locked, but pre-gate capacity recovery works;
- safety recovery atomically clears lock and installs outcome/floor/state or floor-only mode;
- chat/media/files remain usable.

## Cross-tab and checkpoint

- metadata/checkpoint mixed-generation read retries;
- transaction holds lock through canonical-store install;
- crash after write before notification repaired on focus/action;
- generation-10 checkpoint side effect runs after generation 11 and cannot replace latest pointer;
- stale token blob remains unreferenced;
- operational metadata reserve always fits compact lock;
- concurrent evidence merges preserve invariants or lock safely.

## Property/fuzz

- RFC 8785 serializer agrees with fixtures and reference implementation;
- comparator totality/transitivity;
- transition-chain validation and concatenation;
- arbitrary delivery order converges while active;
- no same-epoch install after end;
- every exposed state equals floor digest;
- disposition merge ACI properties;
- stale below-high-water traffic always produces bounded current evidence;
- arbitrary metadata interleavings preserve invariants or enter durable lock.

## Failure mesh and CI

Transport supports directional links, delay, reorder, duplicate, drop, suppressed lifecycle callbacks, partial delivery/crash, and lost generation publication. Implementation PRs must run unit, type, lint, build, and focused E2E checks. Documentation-only commits may have no workflow run.
