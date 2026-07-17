# 09 — Coordinated starts and full-state reconciliation

> **Revision 9 changes:** selects the strongest progressed baseline, persists a current epoch outcome, retires losing sessions, and permanently closes an ended epoch.

## Normal start

Coordinator collects revision-0 proposals, selects deterministically, creates `START_COMMITTED`, then performs one locked metadata mutation:

- raise high water;
- set `epochOutcome = { epoch, canonicalSessionId, status: 'active' }`;
- store active start decision;
- clear older active migration.

Only after the write succeeds is state installed and broadcast.

## Strongest baseline

```ts
const baseline = strongestState(
  stateRef.current,
  bootCheckpointRef.current,
  sync.getActiveStartDecision()?.state,
)
```

The active decision’s revision-0 state never replaces a progressed live/checkpoint state merely because it is persisted evidence.

## Accepting decision/gossip

- reject epoch below high water;
- reject same epoch when outcome is ended;
- compare incoming complete state against the strongest same-epoch baseline;
- equal semantic state is idempotent;
- losing incoming state receives reconciliation when possible;
- winning different-session state requires a matching decision;
- persist outcome/active decision and retirement of the losing session before installing;
- winning same-session divergence updates state without retiring the session.

```ts
await sync.persistStartWinner({
  decision,
  incoming,
  losingSession: local?.sessionId !== incoming.sessionId ? local : null,
})
await clearLosingCheckpoint(...)
installState(incoming)
```

Metadata mutation rechecks that the outcome remains active and the incoming state still wins against the latest persisted baseline.

## Conflict records

Record every same-epoch semantic difference, including equal revision and same session. Conflict IDs bind epoch plus both canonical state digests. `SESSION_RECONCILE` echoes the ID. A different-session reconcile includes the winning start decision.

## Closed epoch

When the canonical session ends, set its outcome to `ended` and clear active decision/migration. A delayed decision for any session at that epoch is permanently rejected. A higher epoch may start normally.

## Switch

Controller switch retires old session as `switched`, raises epoch, installs a new active outcome and decision/state as applicable, and clears old migration. No completed-end certificate is fabricated.

## Tests

- rev1 competing decision cannot replace rev10 checkpoint;
- equal-revision same-session and different-session conflicts converge;
- losing different session is retired;
- canonical end blocks delayed loser resurrection;
- persistence failure exposes no replacement;
- restored decision is the only gossip source.
