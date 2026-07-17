# 10 — Session-bound migration lineage, supersession, and rebasing

> **Revision 11 changes:** migration uses the unified SHA-256 comparator, rebases stale migration descriptors, refreshes generation before election sends, and enters room-wide safety lock on lineage exhaustion.

## Opening authority

On current-controller departure, after `ensureLatestGeneration()`, append:

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

The transaction requires active unclosed outcome, matching story/session/epoch, no terminal disposition, and no safety lock.

## Lineage

Each later controller departure appends. Entries remain until exact-session terminal disposition, higher epoch, or reset. Current-epoch lineage never trims.

At `maxMigrationLineage`, atomically set capacity safety lock and keep all existing authority. Do not discard an older record and do not continue novella controls.

## Announcement authorization

Require selected migration ID in lineage; outer sender = announced/state controller; state session/epoch/story matches active outcome; canonical electorate and round ID; departed controller absent from current transport view; epoch installable; incoming equal to or above floor and able to beat strongest complete baseline.

Delayed announcements from earlier lineage entries remain admissible.

## Application

Inside `transactAndInstall`:

- re-read latest outcome/floor/origin/lineage;
- reselect migration entry;
- recheck generation-independent authorization and closed/safety-lock state;
- compare SHA-256 priority against latest state/floor;
- update selected record’s `lastAppliedState`;
- advance floor;
- synchronously install incoming state.

## Migration reconciliation rebase

If announcement loses, send `SESSION_RECONCILE` with kind `migration`, selected migration ID, latest winner state, and descriptor for the actual pair.

On receipt:

- exact descriptor applies when receiver baseline is the other digest;
- if receiver progressed, rebase incoming against latest baseline;
- incoming winner applies with fresh descriptor;
- incoming loser receives latest winner/fresh descriptor;
- equal digest is idempotent with collision check.

This prevents a rev10 descriptor from becoming unusable after rev11 progress.

## Interaction with session conflicts

Cross-session controller changes reject. A different-session start reconciliation replaces active origin/outcome and clears old lineage. If the new canonical controller is absent, append a new lineage record before election traffic.

## Generation repair

Before advertisements or controller-change sends, refresh latest metadata generation. Focus/visibility refresh also catches a sibling-tab commit whose generation publication was lost.

## Tests

- two/three sequential departures retain earlier IDs;
- delayed earlier-lineage winner converges;
- rev10 descriptor arriving at rev11 rebases;
- delayed weaker announcement receives fresh descriptor;
- full-state and floor digest ordering agree;
- lineage overflow enters safety lock;
- lock-unavailable browser never opens election authority;
- reload/focus refresh preserves lineage;
- cross-session announcement rejects;
- end/higher epoch clears lineage.
