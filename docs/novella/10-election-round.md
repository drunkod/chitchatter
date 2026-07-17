# 10 — Session-bound controller migration lineage and supersession

> **Revision 10 changes:** replaces one active migration with a bounded lineage, authorizes delayed earlier-departure announcements as full-state evidence, and uses symmetric migration conflict descriptors.

## Opening migration authority

On current-controller departure, append:

```ts
const record: MigrationRecord = {
  migrationId: deriveRoundId(
    `migration:${state.sessionEpoch}:${state.sessionId}:` +
    `${departedPeerId}:${state.revision}`),
  sessionEpoch: state.sessionEpoch,
  sessionId: state.sessionId,
  departedControllerPeerId: departedPeerId,
  openedAtRevision: state.revision,
  lastAppliedState: null,
}
```

The transaction requires an active outcome for the same session/epoch/story and no terminal disposition.

## Lineage

`MigrationLineage.records` retains every unresolved departure for the canonical high-water session. A later controller departure appends rather than replaces. Entries remain until:

- exact-session terminal disposition;
- higher epoch;
- explicit reset.

Current-epoch lineage is never trimmed. If `maxMigrationLineage` is reached, the new migration is blocked/read-only and surfaced; existing authority is not discarded.

## Announcement authorization

Require:

- selected `migrationId` exists in lineage;
- outer sender = announced/state controller;
- state session/epoch/story equals lineage and active outcome;
- valid canonical electorate and round digest;
- selected record’s departed controller is absent from local transport view;
- epoch is not ended;
- incoming state is equal to or wins over strongest current/full-state baseline and the outcome floor.

A delayed announcement from an earlier lineage entry remains admissible after later departures and reloads.

## Application

Use `transactAndInstall`:

- re-read latest outcome, floor, and full lineage;
- reselect the migration record;
- recheck closed epoch and comparator;
- update that record’s `lastAppliedState`;
- advance outcome floor;
- synchronously install incoming state.

If the incoming state loses, send `SESSION_RECONCILE` with a symmetric migration descriptor derived from the two state digests and the selected migration ID.

## First-contact migration reconciliation

The recipient need not already hold a runtime conflict record. It validates:

- migration ID in lineage;
- descriptor symmetry and digests;
- incoming same session/epoch/story;
- local baseline digest is the other descriptor digest;
- incoming wins.

It then records and applies atomically.

## Interaction with session conflicts

Cross-session `CONTROLLER_CHANGED` is rejected. A start reconciliation may choose another session; its transaction clears old lineage. If the winning session’s controller is absent, append a new lineage record for that winning session before election traffic.

## Sequential departure example

1. A departs; lineage contains migration A.
2. B wins and progresses.
3. B departs; lineage appends migration B.
4. A-partition’s delayed stronger state arrives under migration A.
5. It remains authorized, compares against current floor, and either wins or receives symmetric reconciliation.

## Tests

- two and three sequential departures preserve earlier migration authority;
- delayed older-lineage stronger announcement converges;
- delayed weaker announcement receives symmetric reconciliation;
- current rev20 beats delayed rev12;
- lineage bound exhaustion fails without trimming;
- reload retains all lineage entries;
- cross-session announcement rejects;
- end/higher epoch clears lineage.
