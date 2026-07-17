# 10 — Durable controller migration and supersession

> **Revision 8 changes:** migration authorization no longer expires by local time, the active migration record is persisted, and controller-change replacement persists before state exposure.

## Local collection round

On current-controller departure, freeze the local canonical electorate and derive the bounded round ID. Local round timers control advertisement collection and retry only; they do not decide whether a later announcement is authorized.

## Persisted migration authority

```ts
const migrationId = deriveRoundId(
  `migration:${state.sessionEpoch}:${state.sessionId}:${departedControllerPeerId}`)

const record: MigrationRecord = {
  migrationId,
  sessionEpoch: state.sessionEpoch,
  sessionId: state.sessionId,
  departedControllerPeerId,
  lastAppliedState: null,
}
```

Persist the record before sending/accepting controller-change announcements. If a peer missed the leave event, it may create the record from an internally consistent announcement only when the announcement concerns its current session/controller, the departed peer is absent from its transport view, and the state is not older.

The record remains authoritative until:

- that exact session/epoch is tombstoned;
- a higher epoch installs;
- local safety metadata is explicitly reset.

`migrationRetryMs` stops active retries; it never makes a delayed valid announcement inadmissible. Reload restores the record before receivers attach.

## Announcement authorization

Require:

- outer sender = announced controller = state controller;
- announced controller = minimum canonical electorate ID;
- digest-bound round fields valid;
- departed peer absent from receiver transport view;
- active migration ID/session/epoch/departed controller match;
- incoming state is equal to or strictly wins over `record.lastAppliedState ?? current` using the shared bytewise comparator.

A delayed competing announcement remains comparable after arbitrary delay and after reload because authorization uses the persisted migration record, not `current.controllerPeerId` or a deadline.

## Application

```ts
const applyControllerChange = async (envelope, context) => {
  const current = stateRef.current!
  const incoming = envelope.payload.state
  const migration = sync.requireActiveMigration(envelope.payload)
  if (!authorizeControllerChange(envelope, context, migration, current)) return

  if (canonicalStateEqual(incoming, migration.lastAppliedState ?? current)) {
    sync.commit(envelope)
    return
  }

  await sync.persistMigrationWinner(migration.migrationId, incoming)
  setPhase('reconciling')
  await clearCheckpointIfLosing(current, incoming)
  installState(incoming)
  sync.commit(envelope)
}
```

Persist before installation. Same session/epoch/revision with different content still uses the comparator.

## Interaction with start conflicts

Announcements may carry competing same-epoch sessions. The shared comparator selects one complete state. The active migration then follows the winning session record persisted by the metadata mutation; losing peers display rollback.

## Tests

- second announcement supersedes after first apply;
- announcement delayed beyond retry timer still applies;
- reload preserves original departure authorization;
- same metadata but different session/content converges;
- persistence failure exposes no replacement;
- higher epoch/end clears migration; unrelated join/leave does not.
