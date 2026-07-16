# 09 — Coordinated start rounds and story switching

> **New step in Revision 5.** Replaces Revision 4's local start-arbitration timers, which provably could not converge: with no bounded delivery delay, peer A could close its window having seen only its own candidate, install it, and later reopen arbitration when B's delayed candidate arrived — while B, having seen both, chose A. Total ordering cannot help when candidate sets differ. The fix is a single deterministic decision point: **only a coordinator commit installs a fresh session.**

## Protocol

```text
starter → coordinator: START_PROPOSE(roundId, candidate)     [targeted]
coordinator: collect proposals for startRoundMs
coordinator → all: START_COMMITTED(roundId, selectedState)   [broadcast]
every peer (starters included): install ONLY on START_COMMITTED
```

- **Coordinator** = `electController([selfId, ...getPeers()])` — the lowest connected transport peer ID, computed by the starter at proposal time. The coordinator may itself be a starter (it then proposes to itself locally).
- **Candidate** = `engine.start(uuid(), starterPeerId, latestEpoch + 1)` — revision 0, controller = the proposing starter (validator-enforced, 03).
- **Selection** = min by `(controllerPeerId, sessionId)` over candidates collected in the window; the `sessionId` tie-break also collapses duplicate proposals from one starter.
- **Epoch assignment**: the coordinator stamps the selected state with `epoch = coordinator's latestEpoch + 1` before committing (candidates proposed with a lower guess are re-stamped; the commit is what defines the epoch).
- **Decided-round guard**: installing or tombstoning an epoch raises `latestEpoch` (08); the pre-dispatch gate then drops any proposal or commit embedding an epoch ≤ `latestEpoch`. A delayed proposal after the commit cannot reopen anything; a replayed commit is a duplicate.

Why this converges where timers could not: no peer installs from its own view of the candidate set. Whatever subset of proposals reaches the coordinator, the coordinator makes exactly one decision per epoch, and that decision is the only installable artifact. Delivery order, candidate-set divergence, and window skew all become irrelevant.

## Failure handling

- **Coordinator never answers** (crashed, or the proposal was lost): the starter times out (`requestTimeoutMs`), recomputes the coordinator from the current transport view, and re-proposes with a fresh `roundId`. If the old coordinator actually committed meanwhile, the commit's epoch raises `latestEpoch` everywhere and the re-proposal dies at the gate.
- **Coordinator leaves mid-window**: same path — its round dies with it; starters re-propose to the next coordinator.
- **Two coordinators** (membership disagreement): both commit; the commits carry the same epoch number only if neither saw the other. The pre-dispatch gate lets the first-arriving commit install and raise `latestEpoch`; the second same-epoch commit is *not* stale by epoch, so break the tie deterministically: a second `START_COMMITTED` at the **same epoch** is accepted iff `(state.controllerPeerId, state.sessionId)` orders below the installed one (same total order as selection); otherwise ignored. Both replicas converge on the same session either way.
- **Commit lost to some peer**: that peer still has null state and an outstanding proposal timeout; its re-proposal is answered by the gate-passing controller path — it bootstraps via `STATE_REQUEST` on seeing any current-epoch traffic, or its re-proposal reaches the coordinator which replies with a targeted snapshot of the committed session.

## Sync-hook implementation sketch

```ts
// --- starter ---
const startSession = async (storyId: string) => {
  if (stateRef.current || pendingStartRef.current) return
  const story = getBundledStory(storyId)
  if (!story) throw new Error('Story is unavailable')
  const candidate = new VisualNovelEngine(story, { now })
    .start(uuid(), selfId, sync.getLatestEpoch() + 1)
  const coordinator = sync.electController([selfId, ...transport.getPeers()])
  const roundId = uuid()
  pendingStartRef.current = { roundId, candidate, coordinator, sentAt: now() }

  if (coordinator === selfId) {
    openStartRoundAsCoordinator(roundId, candidate) // local proposal
  } else {
    await send(makeEnvelope('START_PROPOSE',
      { roundId, candidate }, visualNovelBootstrapScope, 0), { target: coordinator })
    scheduleStartRetry() // requestTimeoutMs → recompute coordinator, re-propose
  }
}

// --- coordinator ---
const handleStartPropose = (envelope, context) => {
  const { candidate } = envelope.payload
  // gate already dropped stale epochs; semantic validation (04) already ran
  if (sync.electController([selfId, ...transport.getPeers()]) !== selfId) return
  if (!startRoundRef.current) {
    startRoundRef.current = {
      roundId: uuid(), coordinatorPeerId: selfId,
      epoch: sync.getLatestEpoch() + 1, candidates: [], openedAt: now(),
    }
    scheduleStartCommit() // setTimeout(startRoundMs)
  }
  startRoundRef.current.candidates.push(candidate)
  sync.commit(envelope)
}

const commitStartRound = async () => {
  const round = startRoundRef.current
  if (!round) return
  startRoundRef.current = null
  const selected = {
    ...sync.chooseStartCandidate(round.candidates), // min (controllerPeerId, sessionId)
    sessionEpoch: round.epoch,
  }
  await broadcastAndInstall('START_COMMITTED',
    { roundId: round.roundId, state: toSnapshotState(selected) }, selected)
}

// --- every peer ---
const handleStartCommitted = (envelope, context) => {
  const { state } = envelope.payload
  // authorization: sender must be the coordinator for this peer's view
  if (context.peerId !== sync.electController([selfId, ...transport.getPeers()]) &&
      stateRef.current !== null) {
    // same-epoch tie-break for dual-coordinator races:
    if (!ordersBelowInstalled(state, stateRef.current)) return
  }
  sync.noteEpoch(state.sessionEpoch)
  setState(state) // the ONLY fresh-session installer
  pendingStartRef.current = null
  sync.commit(envelope)
}
```

(`chooseStartCandidate` lives in the sync service; `ordersBelowInstalled` compares `(controllerPeerId, sessionId)`.)

## The reviewer's divergence scenario, replayed

1. A and B propose concurrently. Coordinator is C (lowest ID).
2. C receives only A's proposal in the window → commits A's session at epoch 1.
3. B's delayed proposal arrives at C after the commit → epoch guard drops it (candidate epoch 1 ≤ latestEpoch 1). C optionally answers B with a targeted snapshot.
4. B installed nothing locally (proposals never install), so there is no "B at revision 0 reopening arbitration" — B receives the commit (or the snapshot) and joins A's session.

No sequence of delays produces two installed sessions, because installation has exactly one source per epoch.

## Story switching — `switchSession`

The React hook previously reused `startSession` for switching, contradicting the null-state precondition and leaving no sending API for the receiver's controller-switch path. Switching is a distinct, controller-only operation that does **not** touch start rounds:

```ts
const switchSession = async (
  storyId: string,
  options: { expectedSessionId: string; expectedRevision: number }
) => {
  const current = stateRef.current
  if (!current || current.controllerPeerId !== selfId) {
    throw new Error('Only the story controller can switch stories')
  }
  if (current.sessionId !== options.expectedSessionId ||
      current.revision !== options.expectedRevision) {
    throw new Error('Session changed; re-confirm the switch') // stale UI guard
  }
  const story = getBundledStory(storyId)
  if (!story) throw new Error('Story is unavailable')

  const next = new VisualNovelEngine(story, { now })
    .start(uuid(), selfId, current.sessionEpoch + 1)

  // Retire the old session FIRST (tombstone locally), then announce the new
  // epoch. Replicas tombstone the old session when they apply the switch.
  sync.tombstone(current.sessionId, current.sessionEpoch)
  await broadcastAndInstall('SESSION_STARTED',
    { state: toSnapshotState(next) }, next)
}
```

Receiver side (matrix row, 08): `SESSION_STARTED` is authorized only from the current controller at exactly `sessionEpoch + 1`, revision 0; applying it tombstones the previous session and clears its checkpoint (15). Late traffic for the old session dies at the gate.

## Tests for this step

- Reviewer scenario above: A-only candidate set at the coordinator, B delayed — both peers end on A's session; B's late proposal is gate-dropped; **at no point does any peer have B's session installed**.
- Three starters, every delivery permutation of proposals and the commit → one session everywhere.
- Coordinator crash before commit → starters re-propose to the next coordinator; exactly one commit installs.
- Dual-coordinator same-epoch commits → all replicas converge via the `(controllerPeerId, sessionId)` tie-break.
- Replayed `START_COMMITTED` is a duplicate; delayed `START_PROPOSE` after commit is epoch-dropped; `START_PROPOSE` for a tombstoned session is gate-dropped.
- `switchSession`: non-controller refused locally and by every replica; stale `expectedRevision` refused; successful switch tombstones the old session, increments the epoch, clears the old checkpoint, and old-session stragglers are ignored everywhere.
