# 10 — Election rounds: frozen electorate, epoch-aware adoption

> **New step in Revision 5.** Two Revision 4 defects are fixed here. First, `chooseElectionState` ordered by bare revision, so after a story switch a lagging peer's `S1@rev20` advertisement beat every `S2@rev0` — the election could atomically restore an obsolete session. Adoption now orders by **`(sessionEpoch, revision)`**, and rounds are scoped to one epoch. Second, the electorate and winner were recomputed from live `getPeers()` at every authorization, so a lower-ID peer joining mid-round made subsets of replicas accept different announcements. Rounds now **freeze** `roundId`, electorate, and winner at open; membership changes deterministically restart the round; joins are deferred.

## Round identity

```ts
// Deterministic: replicas that observed the same departure and membership
// agree on the round without extra messages.
const electionRoundId = (
  sessionEpoch: number,
  departedControllerPeerId: string,
  electorate: string[]
) => `${sessionEpoch}:${departedControllerPeerId}:${[...electorate].sort().join('|')}`
```

`ElectionRound` (02) freezes at open: `roundId`, `sessionEpoch` (of the session being migrated), `departedControllerPeerId`, `electorate` (`[selfId, ...getPeers()]` at the leave event, departed excluded), `winnerPeerId` (`electController(electorate)`), `openedAt`, `advertised`, `applied`.

## Opening, restarting, deferring

- **Open** on the transport leave of the current controller. All conformant replicas see the same leave against the same session epoch and freeze identical rounds.
- **Another peer leaves mid-round** (including the frozen winner): restart deterministically — recompute the electorate from the transport, derive the new `roundId`, re-freeze, re-advertise. Both events are observed by every remaining replica, so restarts stay symmetric.
- **A peer joins mid-round**: **deferred** — the join does not change the frozen electorate or winner. The joiner is not in the electorate, cannot be the winner, and cannot vote; it bootstraps normally after the round closes (its bootstrap `STATE_REQUEST` is answered by the new controller). This removes the "lower-ID joiner splits acceptance" divergence entirely.
- **Close** after `electionRoundMs` past `openedAt` (plus applied-announcement supersession window); `electionRoundRef.current = null`.

## Advertisement and adoption

```text
non-winners → frozen winner: ELECTION_ADVERTISE(roundId, own truncated state)
winner: collect for electionRoundMs; discard entries failing semantic
        validation (04), wrong roundId, or epoch ≠ round.sessionEpoch
winner: adopted = chooseElectionState([own, ...advertised])
        // orders by (sessionEpoch DESC, revision DESC, controllerPeerId ASC)
winner: next = engine.changeController(adopted, selfId)
winner → all: CONTROLLER_CHANGED(roundId, departed, electorate, selfId,
              toSnapshotState(next))
```

The epoch scope is what prevents resurrection: a lagging peer still holding `S1@epoch1rev20` after a switch to `S2@epoch2` either (a) has its advertisement dropped at the winner (epoch ≠ round epoch), or (b) never gets that far — the pre-dispatch gate (08) already drops embedded states below `latestEpoch`. The obsolete session cannot win regardless of its revision.

*(Advertisement provenance remains a crash-fault concession — 00.)*

## Announcement authorization (replica side)

Replaces Revision 4's `authorizeControllerChange`; add to the sync service:

```ts
authorizeControllerChange(
  envelope: VisualNovelActionEnvelope,
  current: VisualNovelSessionState,
  transportPeerId: string,
  selfPeerId: string,
  connectedTransportPeerIds: string[],
  round: ElectionRound | null,
  now: number
): { ok: true } | { ok: false; reason: string } {
  const payload = envelope.payload as VisualNovelPayloadByAction['CONTROLLER_CHANGED']
  // Validator (03) guaranteed: controllerPeerId === state.controllerPeerId
  // === senderPeerId; electorate well-formed; envelope/state consistency.
  if (payload.controllerPeerId !== transportPeerId) {
    return { ok: false, reason: 'sender-mismatch' }
  }

  // Frozen-round matching. If this replica has an open round, identities
  // must match exactly. If it has none (missed the leave event), it may
  // implicitly open the announced round — provided the departed peer is its
  // recorded controller, it is itself in the announced electorate, and the
  // winner claim is consistent with that electorate.
  const openRound = round && now - round.openedAt <= visualNovelLimits.electionRoundMs
    ? round : null
  if (openRound) {
    if (payload.roundId !== openRound.roundId) return { ok: false, reason: 'wrong-round' }
    if (payload.controllerPeerId !== openRound.winnerPeerId) {
      return { ok: false, reason: 'not-frozen-winner' }
    }
  } else {
    if (payload.departedControllerPeerId !== current.controllerPeerId) {
      return { ok: false, reason: 'wrong-round' }
    }
    if (!payload.electorate.includes(selfPeerId)) {
      return { ok: false, reason: 'not-in-electorate' }
    }
    if (payload.controllerPeerId !== this.electController(payload.electorate)) {
      return { ok: false, reason: 'not-elected-winner' }
    }
  }
  if (connectedTransportPeerIds.includes(payload.departedControllerPeerId)) {
    return { ok: false, reason: 'departed-still-connected' }
  }

  // Epoch-aware adoption order: never regress across (epoch, revision).
  const s = payload.state
  const notBehind =
    s.sessionEpoch > current.sessionEpoch ||
    (s.sessionEpoch === current.sessionEpoch && s.revision >= current.revision)
  if (!notBehind) return { ok: false, reason: 'adopted-state-regresses' }

  // Round-scoped supersession after a first application.
  if (openRound?.applied) {
    const a = openRound.applied
    const better =
      s.sessionEpoch > a.sessionEpoch ||
      (s.sessionEpoch === a.sessionEpoch && (
        s.revision > a.revision ||
        (s.revision === a.revision &&
          payload.controllerPeerId < a.controllerPeerId)))
    if (!better) return { ok: false, reason: 'superseded' }
  }
  return { ok: true }
}
```

Application (12) installs `payload.state` atomically — controller and content together — records `round.applied`, and keeps the round open for supersession until `electionRoundMs` elapses.

## Restart-vs-announcement races

A restart (second leave) changes the frozen `roundId` at every replica that saw both leaves. An announcement from the *previous* round then fails `wrong-round` uniformly. The restarted round's winner re-announces with the new identity. A replica that saw only one of the two leaves converges through the implicit-open branch (its recorded controller and electorate membership still determine acceptance) or, in the worst case, through gap recovery targeting the announcer — the adopted-state ordering guarantees no regression either way.

## Tests for this step

- **Epoch resurrection blocked:** switch S1→S2, lag one peer at S1@20, disconnect the controller — the winner adopts an S2 state; the S1@20 advertisement is discarded (wrong epoch at the winner *and* stale at the gate); no replica ever re-installs S1.
- **Frozen winner under join:** open a round with electorate {B, C} (winner B); connect new peer A (lower ID) mid-round; B's announcement is accepted by every replica — none recompute A as winner; A bootstraps after the round.
- **Mid-round leave restarts:** electorate {B, C, D}, C leaves during the round → new roundId with {B, D}; the old round's announcement is `wrong-round` everywhere; the restarted round converges.
- Winner-crash restart; non-winner announcement rejected (`not-frozen-winner` / `not-elected-winner`); departed-still-connected rejected; adopted-state regression rejected; post-application supersession within one round (higher revision, then lower winner ID) converges replicas that applied in different orders; replica that missed the leave converges via implicit open; announcement replay is a duplicate.
