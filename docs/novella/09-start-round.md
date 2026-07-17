# 09 — Coordinated starts, reconciliation, and immutable epoch origins

> **Revision 13 changes:** transition certificates are compact immutable origin proofs; current outcomes advance independently; supersession pages carry no full state.

## Initial start

Coordinator selects a revision-0 proposal deterministically. One transaction:

- requires high water 0;
- validates complete state;
- creates compact `StartDecisionCertificate`;
- creates epoch-1 `initial-start` transition;
- creates active outcome/floor;
- stores origin reference;
- installs state.

The transition stores only the revision-0 floor and compact decision authorization. `activeOrigin` references that transition ID. The complete start state remains available through normal start gossip/snapshot continuity.

## Start after ended epoch

A fresh start creates exactly `highWater + 1`. Its transition:

- records the exact ended predecessor outcome;
- embeds the predecessor completed-end certificate;
- carries a compact start-decision origin and revision-0 successor floor.

The embedded end proof makes the transition independently valid even if the standalone historical certificate array is later compacted.

## Controller story switch

`SESSION_STARTED` carries predecessor subject/revision and one revision-0 successor state. The transaction:

1. verifies sender controlled the predecessor;
2. validates successor state;
3. creates compact session-started origin certificate;
4. appends one `switch` transition;
5. upserts old switched disposition referencing the transition ID;
6. raises high water and installs successor state/outcome/origin;
7. clears predecessor lineage/conflicts/recovery.

## Progression after origin

Progression updates only current outcome floor and canonical state. The transition’s revision-0 origin floor remains unchanged. End changes current outcome status and preserves its latest floor; it also does not rewrite the transition.

## Reconciliation

Complete-state baselines include canonical store, coherent checkpoint, lineage last states, recoverable start state, and durable floor.

- exact descriptor applies;
- stale descriptor rebases;
- different-session winner includes a full valid compact origin transition for the same active epoch;
- if it wins, replace only the active high-water transition slot, active origin, outcome/floor, and predecessor switched evidence; historical slots remain sealed;
- logical reconciled history upserts;
- former loser remains eligible while epoch active;
- floor-only local winner returns floor evidence and starts state recovery.

## Supersession

For stale A after A→B→C, holder pages compact A→B and B→C transitions. Final page carries current C outcome/floor and origin or end certificate. It never carries C’s full state. After proof completion, stale peer adopts C floor and exact-recovers C state if active.

Validation compares C current outcome to C origin by subject identity and floor dominance, not byte equality.

## Tests

- initial, switch, and start-after-ended compact transitions;
- progression to revision 10 preserves revision-0 transition;
- ending after progression validates against origin transition;
- A→B→C and A→B→B-ended paginated recovery;
- compacted standalone predecessor end certificate does not break transition;
- exact/full/floor-only reconciliation paths;
- former loser later wins;
- maximum transition and state never share one oversized envelope.
