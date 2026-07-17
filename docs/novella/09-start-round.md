# 09 — Coordinated starts, decision gossip, and full-state reconciliation

> **Revision 8 changes:** loads a canonical recovery baseline before receivers attach, compares incoming decisions with the persisted active decision even when React state is null, reconciles equal-revision divergence inside the same session, persists before installation, and removes duplicate decision refs.

## Normal start

```text
starter → coordinator: START_PROPOSE(candidate@highWater+1)
coordinator: collect for startRoundMs, choose deterministic candidate
coordinator → all: START_COMMITTED(decision)
recipient: semantic/authority checks → persist active decision/high water → install
```

Decision ID binds epoch, coordinator, origin action, selected controller, and session ID. Proposals never install.

## Single authoritative held decision

The sync service restores and exposes `getActiveStartDecision()` from RoomMeta. Gossip code reads that getter; there is no independent `heldDecisionRef`.

```ts
const gossipHeldDecision = async (target?: string) => {
  const held = sync.getActiveStartDecision()
  const current = stateRef.current ?? bootBaselineRef.current
  if (!held || !current || current.sessionId !== held.state.sessionId) return
  await send(makeEnvelope(
    'START_DECISION_GOSSIP',
    { decision: held, knownState: toSnapshotState(current) },
    bootstrapScope,
    0,
  ), target ? { target } : undefined)
}
```

## Boot baseline

Before the receiver attaches, bootstrap loads:

- validated RoomMeta;
- validated latest checkpoint, if any;
- semantic story for the checkpoint and active records.

`bootBaselineRef` is the checkpoint state or active-decision state. Incoming same-epoch decisions while live React state is null compare against this baseline and persisted active decision. They are never accepted merely because their epoch equals high water.

## Decision acceptance

```ts
const acceptStartState = async (
  decision: StartDecisionRecord,
  incoming: VisualNovelSessionState,
  envelope: VisualNovelActionEnvelope,
  sourcePeerId?: string,
) => {
  const local = stateRef.current ?? bootBaselineRef.current
  const active = sync.getActiveStartDecision()
  const highWater = sync.getLatestEpoch()
  if (incoming.sessionEpoch < highWater) return

  const activeBaseline = active?.state ?? local
  if (!local && incoming.sessionEpoch !== highWater + 1 &&
      incoming.sessionEpoch !== highWater) return

  if (activeBaseline && incoming.sessionEpoch === activeBaseline.sessionEpoch) {
    const order = compareSessionPriority(incoming, activeBaseline)
    if (order < 0) {
      if (sourcePeerId) void sendReconcileState(sourcePeerId, activeBaseline)
      return
    }
    if (order === 0) { sync.commit(envelope); return }
  }

  // Equal session/revision but different semantic bytes also reaches this path.
  const current = local
  if (current && incoming.sessionEpoch === current.sessionEpoch &&
      canonicalStateEqual(incoming, current)) {
    sync.commit(envelope)
    return
  }

  const nextMeta = await sync.persistStartWinner(decision)
  setPhase(current ? 'reconciling' : 'syncing')
  await clearCheckpointIfLosing(current, incoming)
  installState(incoming)
  bootBaselineRef.current = incoming
  sync.commit(envelope)
}
```

Persistence completes before state exposure. Failed persistence leaves the old state/baseline intact and UI read-only.

## Conflict records and reconciliation

Whenever same-epoch semantic states differ—including identical session ID and revision—record a `StartConflict` with a bounded digest `conflictId`. `SESSION_RECONCILE` must echo that ID. Apply only when the incoming state strictly wins the shared comparator.

If the winning controller is reachable, prefer an exact-target `STATE_REQUEST(start-reconcile)`; otherwise the honest-peer full-state reconciliation envelope is admissible.

## Partition behavior

Higher revision wins; ties use lower controller ID, lower session ID, then canonical semantic bytes. Losing novella actions may roll back. UI enters `reconciling`, clears the losing checkpoint, explains the rollback, then renders the winner. Chat/media remain untouched.

## Story switch

Controller-only switch creates exactly `current.epoch + 1`. One serialized metadata mutation tombstones the old session, raises high water, clears old active start/migration, and completes before new state installation/broadcast.

## Tests

- delayed proposals drop while same-epoch decisions/gossip dispatch;
- partial commit + coordinator crash converges;
- boot race: conflicting same-epoch gossip cannot overwrite active decision before checkpoint load;
- equal revision, same session, different branch/variables converges;
- persistence failure exposes no winning replacement;
- gossip uses restored service decision after reload;
- losing checkpoint and rollback UI are correct.
