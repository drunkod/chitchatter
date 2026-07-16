# 09 — Coordinated start rounds and story switching

> **Revision 6 changes:** four review fixes. (1) **Decided-epoch gating is real now** — the gate drops start actions at `embedded.sessionEpoch ≤ latestEpoch` against the embedded candidate's session (08), and `handleStartPropose` additionally requires null local state and `candidate.sessionEpoch === latestEpoch + 1`; a delayed epoch-1 proposal can no longer be restamped into epoch 2. (2) **`START_COMMITTED` always authorizes its sender** — `coordinatorPeerId === sender` is structural (03), acceptance rules below apply at null-state peers too, and same-epoch replacement is only possible while the start decision is unresolved at revision 0: **a progressed session can never be reset.** (3) **Partially delivered decisions recover** — commit holders retain and gossip the commit, and a partition-heal rule reconciles same-epoch conflicts deterministically; per the threat model (00), safety is unconditional and convergence completes under eventual stability. (4) Round IDs use the bounded digest form (01).

## Protocol

```text
starter → coordinator: START_PROPOSE(roundId, candidate)     [targeted]
coordinator: collect proposals for startRoundMs
coordinator → all: START_COMMITTED(roundId, coordinatorPeerId, selectedState)
every peer (starters included): install ONLY on an AUTHORIZED commit
commit holders: retain the commit envelope for decision-recovery gossip
```

- **Coordinator** = `electController([selfId, ...getPeers()])` at proposal time. The coordinator may itself be a starter (local self-proposal).
- **Candidate** = `engine.start(uuid(), starterPeerId, latestEpoch + 1)` — revision 0, controller = proposer (structural, 03).
- **Selection** = min by `(controllerPeerId, sessionId)` over the collected candidates; the `sessionId` tie-break collapses duplicate proposals from one starter.
- **Epoch assignment**: the coordinator stamps the selected state with `epoch = its latestEpoch + 1` at commit time.
- **Decided-epoch guard** (08): installing or tombstoning an epoch raises persisted `latestEpoch`; the gate drops start actions at `≤ latestEpoch` — checked against the **embedded candidate's session**, since start envelopes carry the bootstrap outer scope.

## Start gating (action-specific, on top of the gate)

```ts
const handleStartPropose = (envelope, context) => {
  const { candidate } = envelope.payload
  // Gate already dropped: tombstoned candidate sessions, epochs ≤ latestEpoch,
  // duplicates. Defense in depth + role check:
  if (stateRef.current !== null) return                    // active session: no rounds
  if (candidate.sessionEpoch !== sync.getLatestEpoch() + 1) return // exact next only
  if (sync.electController([selfId, ...transport.getPeers()]) !== selfId) {
    // Not the coordinator: if we HOLD a commit for this epoch, gossip it back
    // to the confused proposer (decision recovery, below).
    const held = heldCommitRef.current
    if (held) void sendRef.current?.(held, { target: context.peerId })
    return
  }
  if (!startRoundRef.current) {
    startRoundRef.current = {
      roundId: deriveRoundId(`start:${sync.getLatestEpoch() + 1}:${selfId}:${uuid()}`),
      coordinatorPeerId: selfId,
      epoch: sync.getLatestEpoch() + 1,
      candidates: [],
      openedAt: now(),
    }
    scheduleStartCommit() // setTimeout(startRoundMs)
  }
  // NEVER restamp: a candidate proposed for a different epoch was already
  // rejected above; candidates enter the round at the round's epoch only.
  startRoundRef.current.candidates.push(candidate)
  sync.commit(envelope)
}
```

## Commit authorization — every peer, every time

The Revision 5 handler skipped sender checks at null-state peers and bypassed the tie-break once state existed. Corrected acceptance, in order:

```ts
const handleStartCommitted = (envelope, context) => {
  const payload = envelope.payload // { roundId, coordinatorPeerId, state }
  // Structural (03): coordinatorPeerId === senderPeerId. Gate: epoch >
  // latestEpoch (≤ dropped), candidate session not tombstoned, not duplicate.
  // Semantic (04): state validated against its story.

  // 1. SENDER AUTHORIZATION — always, including at null-state peers.
  //    Acceptable coordinators: my currently computed coordinator, or the
  //    coordinator my pending proposal targeted (views may have shifted
  //    between proposal and commit).
  const acceptableCoordinators = new Set([
    sync.electController([selfId, ...transport.getPeers()]),
    pendingStartRef.current?.coordinator,
  ])
  if (!acceptableCoordinators.has(payload.coordinatorPeerId)) return

  const current = stateRef.current

  // 2. Null state → install.
  if (current === null) {
    installFreshSession(payload.state, envelope) // noteEpoch + setState + commit
    return
  }

  // 3. Same-epoch conflict. Replacement is possible ONLY while the start
  //    decision is unresolved and nothing has progressed:
  if (payload.state.sessionEpoch === current.sessionEpoch &&
      payload.state.sessionId !== current.sessionId) {
    if (current.revision > 0) {
      // A progressed session is NEVER reset by a revision-0 commit. Instead,
      // gossip our progressed state to the sender (partition-heal, below).
      void sendSnapshot(current, context.peerId)
      return
    }
    if (!startDecisionResolvedRef.current &&
        ordersBelow(payload.state, current)) { // (controllerPeerId, sessionId)
      installFreshSession(payload.state, envelope)
    }
    return
  }
  // Higher-epoch commits were gated as ordinary session succession; lower
  // were dropped at the gate. Same session: duplicate/no-op.
}
```

`installFreshSession` sets `startDecisionResolvedRef.current = true` once the local peer observes progression (any revision ≥ 1 event for the installed session) — from that moment no same-epoch commit is ever accepted, at any peer, in any order.

## Decision recovery (partial delivery + coordinator crash)

The tie-break alone converges only if every competing decision eventually reaches every replica. Under crash + unbounded delay that needs an explicit mechanism; under the threat model (00) the guarantee is: **safety always, convergence once delivery stabilizes.** Three mechanisms:

1. **Commit retention + gossip.** Every peer that installs from `START_COMMITTED` retains the commit envelope (`heldCommitRef`). It re-sends it, targeted, whenever it observes same-epoch confusion: a `START_PROPOSE` for the decided epoch (see `handleStartPropose`), a bootstrap `STATE_REQUEST`, or same-epoch traffic for a *different* session. The decision no longer lives only in the crashed coordinator.
2. **Accepted-decision reporting on re-proposal.** A starter whose coordinator crashed re-proposes to the next coordinator after `requestTimeoutMs`. Any peer holding a commit for that epoch answers the re-proposal with the held commit (mechanism 1), so the new coordinator's round usually never commits — the proposer installs the existing decision instead. If the new coordinator does commit (nobody who held the decision was reachable), the same-epoch rules reconcile:
3. **Partition-heal rule.** Same-epoch, different-session conflict between two installed sessions:
   - one side progressed (revision > 0), the other at revision 0 → **the progressed session wins**; the revision-0 holder adopts it via the gossiped snapshot;
   - both at revision 0 → total order `(controllerPeerId, sessionId)`;
   - both progressed (only possible across a real partition) → total order `(controllerPeerId, sessionId)` decides, and losers adopt the winner via snapshot on heal — deterministic at every peer, so both populations converge to the same choice when traffic flows again.

### The reviewer's partial-commit scenario, replayed

1. Coordinator C commits session A; only D receives it before C crashes.
2. Starters time out, re-propose to new coordinator C′.
3. D receives a re-proposal or C′'s eventual same-epoch commit for session B:
   - If D's re-proposal answer (held commit A) reaches C′/starters first, they install A. Converged.
   - If C′'s commit B lands first at the others: D at A@rev0 vs B — total order decides identically at D and everyone else (D either adopts B or gossips A, which now reaches peers *because D holds it* — the decision is no longer trapped in the crashed C).
   - If D progressed A before hearing about B (D is with A's controller in a partition): on heal, both-progressed rule picks one deterministic winner; the losing population adopts via snapshot.
4. Controller A "not knowing it was selected" is harmless: a session whose controller never learned of it cannot progress; it sits at revision 0 and loses to any progressed session, or resolves by total order.

No scenario leaves two populations that both keep their sessions after delivery stabilizes — and no scenario ever violates safety meanwhile, because every rule is deterministic in the pair of states being compared.

## Failure handling summary

- Coordinator silent → `requestTimeoutMs` → re-propose to recomputed coordinator (fresh `roundId`). Held-commit answers short-circuit duplicate decisions.
- Coordinator leaves mid-window → round dies with it; same re-proposal path.
- Dual coordinators (membership disagreement) → both commits carry sender authorization from their own view; replicas accept per the acceptable-coordinator set, then reconcile by the same-epoch rules. Deterministic either way.
- Commit lost to some peer → that peer re-proposes or bootstraps; any commit holder answers.

## Story switching — `switchSession`

Unchanged from Revision 5 (controller-only, `expectedSessionId`/`expectedRevision` guard, tombstone old session, epoch + 1, `SESSION_STARTED` broadcast, never enters start rounds) — with one addition: the tombstone written for the replaced session persists via `RoomMeta` (08/15), so the retired session stays dead across reloads.

## Tests for this step

- **Decided-epoch guard, both layers:** with epoch 1 committed, a delayed epoch-1 proposal is gate-dropped (`≤`); a synthetic proposal that somehow reaches the handler with wrong epoch or non-null state is refused; no round reopens; nothing is restamped.
- **Sender authorization at null state:** a `START_COMMITTED` from a non-coordinator is rejected by a null-state peer (the Revision 5 hole); one from the proposal-target coordinator is accepted even if the local view shifted.
- **No reset after progression:** install A, progress to revision 10, deliver a same-epoch revision-0 commit for B from the current coordinator — rejected, and the sender receives A's snapshot instead.
- **Unresolved same-epoch tie-break:** two commits at revision 0 converge on `(controllerPeerId, sessionId)` order at every delivery permutation; after any progression event, the loser can no longer displace the winner.
- **Partial-commit recovery (reviewer scenario):** C commits A to D only, C crashes, C′ commits B — permute deliveries and partitions; assert every peer ends on the same session once the mesh reconnects, and that D's held commit answers a re-proposal.
- **Both-progressed heal:** progress A and B in disjoint partitions, heal, assert deterministic winner and loser adoption via snapshot.
- Replayed commit = duplicate; proposal for tombstoned session = gate-dropped (embedded check); `switchSession` cases from Revision 5, plus tombstone persistence across a simulated reload.
