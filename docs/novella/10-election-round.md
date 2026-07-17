# 10 — Session-bound controller migration and supersession

> **Revision 9 changes:** compares against current progress as well as recorded winner and explicitly rejects cross-session announcements until start reconciliation completes.

## Migration authority

On current-controller departure, persist:

```ts
const record: MigrationRecord = {
  migrationId: deriveRoundId(
    `migration:${state.sessionEpoch}:${state.sessionId}:${departedPeerId}`),
  sessionEpoch: state.sessionEpoch,
  sessionId: state.sessionId,
  departedControllerPeerId: departedPeerId,
  lastAppliedState: null,
}
```

The record remains until exact-session retirement, a higher epoch, explicit reset, or replacement by a newly opened migration for the same canonical session. Retry timers do not affect authorization.

## Session-bound rule

`CONTROLLER_CHANGED.state.sessionId` and epoch must equal the active migration. Cross-session announcements are rejected. Same-epoch session conflicts first resolve through start decision/reconciliation. After installing a different winning session:

1. clear the losing session’s migration;
2. inspect the winning state’s controller;
3. if absent, persist a new migration record for that winning session before election traffic.

This removes the Revision 8 contradiction between a session-bound migration ID and cross-session adoption.

## Strongest migration baseline

```ts
const baseline = strongestState(
  stateRef.current,
  migration.lastAppliedState,
)
```

Incoming controller-change state must equal or strictly win over this baseline. A delayed revision-12 announcement cannot replace current revision 20. When incoming loses, send exact-target migration reconciliation with the current winner.

## Application

```ts
await sync.persistMigrationWinner({
  migrationId: migration.migrationId,
  incoming,
  expectedBaseline: baseline,
})
setPhase('reconciling')
await clearLosingCheckpointIfNeeded(...)
installState(incoming)
```

The locked mutation rechecks current metadata, session, epoch, migration ID, and comparator before writing.

## Announcement fields

Require outer sender = announced/state controller, announced controller = minimum canonical electorate, valid digest-bound round fields, departed peer absent from receiver’s view, and active migration match.

## Tests

- delayed announcement never replaces newer current progress;
- delayed better announcement supersedes older state after reload;
- cross-session controller change is rejected;
- start reconciliation to another session clears/reopens migration correctly;
- write failure exposes no replacement;
- exact end/higher epoch clears migration.
