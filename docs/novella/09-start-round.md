# 09 — Coordinated starts, reconciliation, and epoch transitions

> **Revision 12 changes:** every new epoch persists a transition certificate, switch recovery uses a retained chain rather than only current origin, and floor-only losers receive floor evidence.

## Initial start

Coordinator selects revision-0 proposal deterministically. One transaction:

- requires `highWaterEpoch === 0`;
- creates the epoch-1 `initial-start` transition;
- creates active outcome/floor;
- stores active origin referencing the transition/start decision;
- installs exact state;
- clears obsolete runtime operations.

Broadcast follows success.

## Start after ended epoch

A fresh start after an ended outcome creates exactly `highWater + 1` and an `EpochTransitionCertificate(kind: 'start-after-ended')` whose predecessor is the exact ended outcome. The transition and new state install atomically.

## Reconciliation

Complete-state baselines include canonical store, coherent checkpoint, lineage states, active-origin state where available, and floor. All use the RFC 8785 SHA-256 comparator.

- exact descriptor path applies normally;
- stale descriptor path rebases;
- different-session winner carries origin/transition evidence;
- logical reconciled disposition upserts by `(epoch, losingSession, reconciled)`;
- former loser remains eligible while epoch active;
- floor-only local winner returns floor evidence and begins full-state recovery.

## Controller story switch

`SESSION_STARTED` payload contains predecessor subject/revision and revision-0 successor state. The transaction:

1. verifies sender controls the predecessor;
2. creates one `switch` transition certificate;
3. upserts switched disposition with `evidenceId = transitionId`;
4. raises high water exactly one;
5. stores successor outcome/floor and active origin;
6. installs successor state;
7. clears predecessor lineage/conflicts/recovery.

## Supersession chain

For stale session A after A→B→C, holder sends both retained transitions A→B and B→C plus current C outcome/origin/state. If C ended, current origin is null and C’s completed-end certificate is included. The A disposition’s evidence ID remains the A→B transition ID.

Every below-high-water subject receives a chain beginning after its epoch, even if its exact disposition was compacted.

## Tests

- RFC 8785/full-floor winner equivalence;
- initial and start-after-ended transitions;
- A→B→C delayed A recovery;
- A→B then B ended delayed A recovery;
- stale descriptor exact/full-state/floor-only paths;
- former loser later wins;
- repeated reconciliation uses one slot;
- switch envelope action/state/predecessor mismatch rejects;
- ended high-water rejects queued installs.
