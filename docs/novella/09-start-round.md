# 09 — Coordinated starts, decision gossip, and reconciliation

> **Revision 7 changes:** same-epoch decisions are no longer blocked by the common gate; retained decisions use a new outer envelope whose sender is the holder; conflict resolution can carry a full state; persistence retains the active decision across reloads; the design is documented as availability with deterministic rollback, not strict consensus.

## Normal start

```text
starter → local coordinator: START_PROPOSE(proposalId, candidate@epoch n+1)
coordinator: collect for startRoundMs
coordinator → all: START_COMMITTED(decision)
recipients: validate, persist epoch + active decision, install revision-0 state
```

The decision ID binds epoch, coordinator, origin action, selected controller, and session ID. Proposals never install state.

## Proposal handling

```ts
const handleStartPropose = (envelope: EnvelopeFor<'START_PROPOSE'>, context: MessageContext) => {
  const candidate = envelope.payload.candidate
  if (stateRef.current !== null) return
  if (candidate.sessionEpoch !== sync.getLatestEpoch() + 1) return
  if (sync.electController([selfId, ...transport.getPeers()]) !== selfId) {
    void gossipHeldDecision(context.peerId)
    return
  }
  openOrAppendStartRound(candidate)
  sync.commit(envelope)
}
```

The gate already drops proposal epochs at `<= highWaterEpoch`.

## Commit creation

```ts
const commitStartRound = async () => {
  const selected = chooseStartCandidate(round.proposals)
  const state = { ...selected, sessionEpoch: round.epoch }
  const originActionId = uuid()
  const decision: StartDecisionRecord = {
    coordinatorPeerId: selfId,
    originActionId,
    state,
    decisionId: deriveRoundId([
      'start', state.sessionEpoch, selfId, originActionId,
      state.controllerPeerId, state.sessionId,
    ].join(':')),
  }
  const envelope = makeEnvelope('START_COMMITTED', { decision }, bootstrapScope, 0)
  await acceptStartDecision(decision, state, envelope)
  await send(envelope)
}
```

Local acceptance persists `RoomMeta.highWaterEpoch` and `activeStartDecision` before enabling the story UI.

## Identity-safe gossip

Never retransmit the original `START_COMMITTED` envelope from another transport peer. That would fail `senderPeerId === context.peerId`.

```ts
const gossipHeldDecision = async (target?: string) => {
  const held = heldDecisionRef.current
  const current = stateRef.current
  if (!held || !current || current.sessionId !== held.state.sessionId) return
  await send(makeEnvelope(
    'START_DECISION_GOSSIP',
    { decision: held, knownState: toSnapshotState(current) },
    bootstrapScope,
    0,
  ), target ? { target } : undefined)
}
```

The outer envelope names the holder. The embedded decision preserves the origin coordinator. This remains an accepted crash-fault provenance concession until signatures exist.

## Decision acceptance and conflict resolution

```ts
const acceptStartDecision = async (
  decision: StartDecisionRecord,
  knownState: VisualNovelSessionState,
  envelope: VisualNovelActionEnvelope,
  sourcePeerId?: string,
) => {
  const current = stateRef.current
  const highWater = sync.getLatestEpoch()

  if (knownState.sessionEpoch < highWater) return

  if (current === null) {
    if (knownState.sessionEpoch !== highWater + 1 &&
        knownState.sessionEpoch !== highWater) return
    await sync.noteEpoch(knownState.sessionEpoch, decision)
    installState(knownState)
    sync.commit(envelope)
    return
  }

  if (knownState.sessionEpoch !== current.sessionEpoch) return
  if (knownState.sessionId === current.sessionId) {
    if (knownState.revision > current.revision) installState(knownState)
    sync.commit(envelope)
    return
  }

  conflictRef.current = {
    epoch: current.sessionEpoch,
    localSessionId: current.sessionId,
    remoteSessionId: knownState.sessionId,
  }

  const remoteWins = compareSessionPriority(knownState, current) > 0
  if (remoteWins) {
    setPhase('reconciling')
    installState(knownState)
    await sync.noteEpoch(knownState.sessionEpoch, decision)
  } else {
    if (sourcePeerId) void sendReconcileState(sourcePeerId, current)
  }
  sync.commit(envelope)
}
```

`SESSION_RECONCILE` carries the sender’s latest known full state. A receiver applies it only while a conflict for that epoch is recorded and only if the incoming state wins `compareSessionPriority`.

## Availability and rollback behavior

A partition can let two honest same-epoch sessions progress. On heal:

- higher revision wins;
- equal revision uses lower controller ID, lower session ID, then canonical full-state string;
- the loser visibly enters `reconciling`, replaces state atomically, and clears the losing checkpoint;
- chat and media are unaffected;
- the UI explains that novella actions made in the losing partition were rolled back.

This is deterministic reconciliation, not strict consensus. Tests and README must use that wording.

## Reload recovery

`RoomMeta.activeStartDecision` and the current checkpoint load before receivers attach. A peer with high-water epoch `n` and no live React state may accept a same-epoch held decision/gossip for `n`; it must not require `n + 1` in that recovery case.

## Story switching

`switchSession` remains controller-only and creates exactly `current.sessionEpoch + 1`. It tombstones the previous session and clears `activeStartDecision` for the retired epoch after the new epoch metadata is durably written.

## Tests

- delayed proposal at decided epoch is dropped;
- same-epoch commit and gossip reach reconciliation;
- retransmitted original envelope fails in a negative test, while `START_DECISION_GOSSIP` succeeds;
- partial commit followed by coordinator crash converges after heal;
- same-epoch conflicts at revision 0 and at progressed revisions use the one comparator;
- reload restores active decision before processing gossip;
- losing-partition checkpoint is cleared and UI shows reconciliation/rollback.
