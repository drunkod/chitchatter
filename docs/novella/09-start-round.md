# 09 — Coordinated starts and symmetric full-state reconciliation

> **Revision 10 changes:** reconciliation dispositions are nonterminal while active, conflict descriptors are symmetric/self-verifying, the outcome floor advances transactionally, and closed epochs reject all recovery/install paths.

## Normal start

Coordinator collects revision-0 proposals and selects deterministically. One `transactAndInstall` operation:

- requires candidate epoch `highWater + 1`;
- creates `EpochOutcome(status: 'active', floor: floorFromState(state))`;
- stores the start decision;
- clears older migration lineage;
- installs the exact state synchronously.

Broadcast and duplicate commit occur after transaction success.

## Baselines

Full-state comparison uses:

1. current canonical store state;
2. boot checkpoint candidate;
3. every relevant migration-lineage last state;
4. active start decision revision-0 evidence;
5. the durable outcome floor.

A full state below the floor loses even when no complete local state is available.

## Decision/gossip acceptance

- reject below high water;
- reject every same-epoch decision when outcome is ended;
- require immutable story identity for same session;
- compare incoming against strongest complete baseline and floor;
- equal digest is idempotent;
- losing incoming state receives reconcile evidence when possible;
- winning different session requires its matching decision;
- transaction updates outcome/session/floor, active decision, and adds a `reconciled` disposition for the losing session;
- winning same-session state advances only floor/state and does not dispose the session.

A `reconciled` disposition clears the losing checkpoint and informs UI, but does not block later valid complete-state evidence while the outcome remains active.

## Symmetric conflict descriptor

Derive:

```text
lowerDigest, higherDigest = sortBytes(digest(local), digest(remote))
sessionIdA, sessionIdB = sortBytes(local.sessionId, remote.sessionId)
conflictId = deriveRoundId(kind, epoch, sessionIdA, sessionIdB,
                           migrationId-or-empty, lowerDigest, higherDigest)
```

`SESSION_RECONCILE` carries the full descriptor. A recipient recomputes it using its current/floor baseline and incoming state. It may create the conflict record atomically on first contact.

Different-session reconcile includes the incoming session’s `StartDecisionRecord`. Same-session reconcile requires exact story ID/version equality.

## Stronger former loser

If a session with a prior `reconciled` disposition later presents a state that wins the comparator and floor checks, it may become canonical again. The old canonical session receives its own `reconciled` disposition. This is intentional availability-with-eventual-reconciliation behavior.

Terminal suppression occurs only for:

- exact `ended` certificate/disposition;
- `switched` session;
- any older epoch.

## Ended epoch

Ending the canonical outcome:

- sets status `ended`;
- preserves final floor;
- clears active decision and migration lineage;
- cancels same-epoch conflicts and outstanding recoveries;
- rejects all later start, snapshot, reconcile, restart, progression, and migration state installation at that epoch.

A higher epoch may start normally.

## Switch

Controller switch transaction:

- terminally disposes old session as `switched`;
- creates exactly `highWater + 1`;
- creates new outcome and floor;
- stores decision evidence when applicable;
- clears old lineage/conflicts/recoveries;
- installs new state.

No completed-end certificate is fabricated.

## Tests

- former loser progresses beyond winner and can converge back while epoch active;
- equal-revision same-session/different-session conflicts converge;
- opposite peers derive identical conflict IDs;
- first reconcile creates conflict record;
- rev1 decision cannot replace rev10 checkpoint/floor;
- ended epoch rejects decision, snapshot, reconcile, restart, migration response;
- same-session different story/version rejects;
- persistence/transaction failure exposes no replacement.
