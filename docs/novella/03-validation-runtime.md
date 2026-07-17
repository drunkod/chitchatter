# 03 — Runtime structural validation and normalization

> **Revision 8 changes:** validates `SESSION_END_NOTICE_GOSSIP`, reconciliation conflict IDs, durable migrations, and complete RoomMeta cross-field invariants.

## General order

1. bound the encoded envelope before deep traversal;
2. validate protocol, action, IDs, revision, timestamp, and payload shape;
3. normalize every nested collection into fresh objects;
4. cross-check outer scope against embedded state where applicable;
5. drop unknown properties and MVP `proof`;
6. perform semantic story checks separately in 04.

Existing `isId`, `isEpoch`, `isRevision`, `utf8Bytes`, variable/history/state validators, and final snapshot/envelope byte gates remain mandatory.

## Start and reconciliation payloads

`validateStartDecision` requires revision 0 and recomputes:

```ts
const expectedDecisionId = deriveRoundId([
  'start', state.sessionEpoch, coordinatorPeerId, originActionId,
  state.controllerPeerId, state.sessionId,
].join(':'))
```

- `START_COMMITTED`: embedded coordinator equals outer sender.
- `START_DECISION_GOSSIP`: outer sender is only the holder; decision and known state must share session/epoch, and known state revision is at least decision revision.
- `SESSION_RECONCILE`: `conflictId` is a valid ID and state is normalized; outer sender is the holder, not necessarily the state controller.

## Completed-end certificate

```ts
const validatePersistedEndNotice = (
  input: unknown,
): ValidationResult<PersistedEndNotice> => {
  if (!isRecord(input) || !isId(input.sessionId) || !isEpoch(input.epoch)) {
    return fail('Invalid retained end notice')
  }
  const end = validateEnvelope(input.endEnvelope)
  if (!end.ok || end.value.actionType !== 'SESSION_ENDED') {
    return fail('Invalid retained end envelope')
  }
  if (end.value.sessionId !== input.sessionId) {
    return fail('Retained end scope mismatch')
  }
  return {
    ok: true,
    value: {
      sessionId: input.sessionId,
      epoch: input.epoch,
      endEnvelope: end.value as EnvelopeFor<'SESSION_ENDED'>,
    },
  }
}
```

`SESSION_END_NOTICE_GOSSIP` contains only this normalized certificate. Its outer envelope uses bootstrap scope/revision 0 and identifies the holder. Receivers never require the holder to equal the original end-envelope sender.

## Election and migration fields

`CONTROLLER_CHANGED.electorate` remains sorted, unique, non-empty, at most 64, valid IDs, and excludes the departed controller. Recompute the digest-bound round ID and require announced controller = state controller = outer sender = minimum electorate ID.

`MigrationRecord` validation recomputes:

```ts
migrationId === deriveRoundId(
  `migration:${sessionEpoch}:${sessionId}:${departedControllerPeerId}`)
```

If `lastAppliedState` exists, it must share the record session and epoch.

## Envelope scope rules

- start proposal/commit/gossip, end-notice gossip: bootstrap outer scope, revision 0;
- reconciliation: outer scope matches payload state so participation and stale-epoch gates have an exact subject;
- normal state-carrying actions: outer session/story/version/revision equal embedded state;
- original `SESSION_ENDED` scope is the ended live session; its epoch comes from the validated persistent certificate when gossiped.

## RoomMeta normalization

```ts
export const validateRoomMeta = (input: unknown): ValidationResult<RoomMeta> => {
  // First enforce maxRoomMetaBytes, version, generation/highWater safe integers,
  // tombstone count, normalized notices, active decision, and active migration.
  // Then enforce cross-field invariants below.
}
```

Mandatory cross-field rejection rules:

- any tombstone epoch greater than high water;
- duplicate or non-canonically ordered tombstones;
- active decision epoch different from high water;
- active decision session present in tombstones;
- active migration epoch different from high water;
- active migration session tombstoned;
- active migration `lastAppliedState` mismatch;
- active decision and active migration describing different sessions at one epoch;
- retained end-envelope scope mismatch.

Malformed existing metadata blocks receiver mount. It never degrades silently to empty safety metadata.

## Required tests

- alias-free normalization of every action and record;
- holder identity independent of embedded start/end origin;
- invalid end certificate, decision ID, migration ID, reconcile conflict ID, and election digest rejected;
- every RoomMeta cross-field contradiction rejected;
- canonical tombstone order and configured bounds enforced.
