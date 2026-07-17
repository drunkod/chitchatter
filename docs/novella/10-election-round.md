# 10 — Lineage-bound controller migration and rebasing

> **Revision 12 changes:** advertisements identify exact migration records, retained authority survives controller rejoin, and floor-only migration conflicts return floor evidence.

## Opening migration authority

After `ensureLatestGeneration()`, current-controller absence may append:

```ts
const record: MigrationRecord = {
  migrationId: deriveRoundId(rawEpochSessionDepartedRevisionFields),
  sessionEpoch: state.sessionEpoch,
  sessionId: state.sessionId,
  departedControllerPeerId: departedPeerId,
  openedAtRevision: state.revision,
  lastAppliedState: null,
}
```

Absence is checked here. Once persisted, later peer rejoin does not revoke the record.

## Lineage

Sequential departures append records and never replace older unresolved authority. Records remain until terminal disposition, higher epoch, or reset. Lineage-capacity exhaustion writes the durable capacity lock using reserved headroom.

## Advertisement

```ts
ELECTION_ADVERTISE {
  roundId,
  migrationId,
  departedControllerPeerId,
  openedAtRevision,
  state,
}
```

Validator selects the exact lineage record and recomputes round ID from migration ID, epoch/session, departed controller, opening revision, sender, and state digest. Interleaved advertisements for different lineage records cannot share one round.

## Controller changed

`CONTROLLER_CHANGED` repeats migration ID and departed-controller identity, includes canonical electorate/controller, and carries complete state. Authorization requires the selected lineage record but does **not** require the departed peer to remain absent.

Inside `transactAndInstall`:

- re-read latest outcome/floor/origin/lineage;
- reselect record;
- recheck closed/safety state;
- compare against latest full state/floor;
- update selected record’s last-applied state;
- advance floor and install.

## Migration rebase

A weaker announcement receives a migration-kind reconcile descriptor. On stale delivery:

- incoming winner applies with fresh descriptor;
- complete local winner is returned with fresh descriptor;
- floor-only local winner returns `STATE_FLOOR_GOSSIP` and starts recovery;
- equal digest is idempotent subject to collision checks.

## Tests

- two/three lineage records and interleaved advertisements;
- advertisement missing/wrong migration ID rejects;
- departed controller rejoins before delayed earlier-lineage announcement;
- delayed earlier-lineage stronger state converges;
- descriptor rev10→rev11 rebase with full and floor-only receiver;
- lineage overflow persists capacity lock;
- lock-unavailable browser opens no authority;
- end/higher epoch clears lineage.
