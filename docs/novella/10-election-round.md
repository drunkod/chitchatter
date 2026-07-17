# 10 — Transcript-bound controller migration and rebasing

> **Revision 13 changes:** one stable migration round is shared by all advertisements, controller change carries a canonical transcript and one winning pre-change state, and every election ID has exact derivation.

## Opening migration authority

After generation refresh, current-controller absence may append:

```ts
const migrationId = deriveProtocolId('migration-record', {
  sessionEpoch,
  sessionId,
  departedControllerPeerId,
  openedAtRevision,
})

const migrationRoundId = deriveProtocolId('migration-round', {
  migrationId,
  sessionEpoch,
  sessionId,
  departedControllerPeerId,
  openedAtRevision,
})
```

Absence is checked only here. Later rejoin does not revoke the record.

## Advertisement

Each participant sends:

```ts
ELECTION_ADVERTISE {
  migrationRoundId,
  advertisementId,
  candidatePeerId: selfPeerId,
  state,
}
```

`advertisementId` derives from round ID, sender/candidate, and validated state priority. The outer sender equals candidate. All advertisements for one migration record share the same `migrationRoundId`.

## Transcript construction

After retry collection, a peer:

1. deduplicates advertisements by sender;
2. converts each to `ElectionAdvertisementSummary`;
3. sorts summaries by sender ID;
4. selects the winner by greatest state priority, then lower candidate ID, then lower advertisement ID;
5. derives `transcriptId`;
6. sends `CONTROLLER_CHANGED` with the transcript and the complete winning pre-change state.

The electorate is exactly the transcript’s sender set. There is no separately asserted electorate.

## Controller change application

Receiver validates:

- round selects one retained migration record;
- every summary and advertisement ID recomputes;
- transcript is sorted/unique and within bounds;
- winner is deterministic;
- `winningState` matches winner priority/digest.

Receiver then locally derives:

```ts
const changed = engine.changeController(
  validatedWinningState,
  winner.candidatePeerId,
)
```

The result is semantically validated, JCS-digested, compared against current state/floor, and installed if authorized. This keeps the action below the envelope limit because only one full state is transported.

## Competing transcripts

Different partitions may collect different valid transcripts for the same round. Each produces a valid derived state. Delayed results compare through the ordinary state comparator and migration reconciliation. Transcript authority proves a valid local election observation, not Byzantine consensus.

## Lineage

Sequential departures append records and retain earlier authority until terminal disposition, higher epoch, or reset. `lineage-limit` writes a recoverable capacity lock; a verified higher epoch may clear it because old lineage is superseded.

## Migration rebase

A weaker derived controller-change state receives migration reconcile evidence. Full-state and floor-only stale paths follow the common rebase rules.

## Tests

- multiple advertisements share one round ID;
- advertisement IDs and transcript ID match browser/Node fixtures;
- transcript order, duplicate sender, wrong winner, wrong state reject;
- two partitions produce different valid transcripts and later converge by state comparator;
- controller rejoin does not revoke retained lineage;
- one max state plus max transcript fits envelope;
- lineage-limit accepts fitting higher-epoch safety recovery;
- transition-limit does not.
