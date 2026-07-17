# 09 — Coordinated starts, rebasing reconciliation, and story switch

> **Revision 11 changes:** uses the SHA-256 comparator everywhere, persists generalized active origin, rebases stale descriptors, deterministically upserts reconciliation history, and gives switched notices complete successor evidence.

## Normal start

Coordinator collects revision-0 proposals and selects deterministically. One `transactAndInstall` operation:

- requires candidate epoch `highWater + 1`;
- creates active outcome/floor;
- stores `activeOrigin = { kind: 'start-decision', decision }`;
- clears old lineage/conflicts/recovery;
- installs exact validated state.

Broadcast and duplicate commit follow transaction success.

## Baselines

Complete-state comparison considers current canonical store, coherent boot checkpoint, every lineage last state, active-origin revision-0 state, and durable floor. All use the same SHA-256 final tie-break.

A floor-only peer cannot reverse the winner selected by a full-state peer.

## Decision/gossip acceptance

- reject below high water or at ended high water;
- require immutable story identity for same session;
- compare incoming against strongest complete baseline and floor;
- digest equality is idempotent only when complete-state canonical bytes also match;
- winning different session requires matching origin;
- transaction replaces outcome/floor/origin, upserts one reconciled disposition for loser, and installs;
- winning same-session state advances floor/state only.

Disposition upsert key is `(epoch, losingSessionId, 'reconciled')`; canonical informational `evidenceId` is the bytewise minimum conflict ID seen for that logical record.

## Exact and stale conflict descriptors

```text
incoming digest belongs to descriptor
latest baseline digest == other digest → exact path
latest baseline digest changed          → rebase path
```

Rebase path compares incoming with latest baseline/floor, then:

- incoming wins: derive a fresh descriptor from latest+incoming and apply;
- incoming loses: return latest state with fresh descriptor;
- equal: idempotent commit.

The response’s new descriptor supersedes runtime records for the stale conflict ID. Repeated stale deliveries therefore converge instead of looping.

## Former loser

A current-epoch reconciled timeline may later present stronger complete state. It remains eligible. If it wins, the former winner receives its own reconciled disposition and the outcome/origin/floor switch atomically.

## Ended epoch

Ending canonical outcome preserves final floor, clears active origin/lineage, cancels conflicts/recoveries, and blocks every same-epoch install path.

## Story switch and successor evidence

Controller-authorized switch creates exact next epoch with a revision-0 `SESSION_STARTED` state. The transaction:

- adds switched disposition for old session with `evidenceId = newOrigin.actionId`;
- raises high water;
- creates active outcome/floor;
- stores `activeOrigin = { kind: 'session-started', ... }`;
- installs new state;
- clears old lineage/conflicts/recovery.

A holder replying about the switched session sends:

```ts
SESSION_RETIREMENT_GOSSIP {
  disposition,
  successor: {
    outcome: currentOutcome,
    origin: currentOrigin,
    knownState: currentStateOrNull,
  },
}
```

The stale receiver merges disposition and successor atomically. Full known state installs if it exactly matches floor; otherwise floor-only recovery starts.

## Tests

- full-state/floor digest tie picks same winner;
- former loser later wins and reversed delivery converges;
- exact descriptor and rev10→rev11 rebase;
- repeated logical reconciliation uses one disposition slot;
- different-session reconcile accepts either origin type;
- same-session story mismatch rejects;
- switched notice before successor snapshot raises high water and enters recovery;
- ended epoch rejects queued decision/snapshot/reconcile;
- transaction failure exposes no replacement.
