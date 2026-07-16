# 10 — Election rounds: local freezing, joint convergence

> **Revision 6 changes:** two review fixes. (1) **Round IDs are bounded digests** (`deriveRoundId`, 01) — the concatenated pipe-joined form failed `isId`'s charset and length, so multi-peer election traffic was rejected by the validator feeding this very protocol; the payload carries the raw round fields and the validator verifies the digest **binds** them (03). (2) **Frozen membership is acknowledged as a local observation, not an agreement.** Honest replicas can freeze *different* rounds (they saw different membership when the leave fired), and Revision 5's exact-`roundId` matching would deadlock them on mutual `wrong-round`. Acceptance is now based on the announcement's own **internally consistent fields plus self-relevant conditions**, with a **total supersession order across announcements** — divergent views converge instead of rejecting each other. Per the threat model (00): safety unconditional, convergence under eventual stability.

## Round identity

```ts
const electionRoundId = (
  sessionEpoch: number,
  departedControllerPeerId: string,
  electorate: string[] // canonical: sorted unique, departed excluded
) => deriveRoundId(
  `${sessionEpoch}:${departedControllerPeerId}:${electorate.join(',')}`)
```

Bounded (17 chars), `isId`-clean, synchronous (01). Collision resistance is not load-bearing: `CONTROLLER_CHANGED` carries the raw fields, receivers compare them exactly, and the structural validator recomputes the digest to verify the binding (03) — the ID is a dedup/bookkeeping key, the fields are the authority.

`ElectionRound` (02) freezes this replica's **local view** at open: `roundId`, `sessionEpoch`, `departedControllerPeerId`, canonical `electorate` (`[selfId, ...getPeers()]` minus departed, sorted unique), `winnerPeerId`, `openedAt`, `advertised`, `applied`.

## What freezing does and does not claim

Freezing prevents this replica's electorate from drifting while its round is open — the Revision 5 join-mid-round divergence stays fixed. It does **not** make the electorate agreed across replicas: B may freeze `{B, C}` (winner B) while C, having transiently lost sight of B, freezes `{C}` (winner C). Both are honest. The protocol therefore never requires an announcement to match the local round exactly; the local round governs only **this replica's own behavior** (whether to advertise, whether to announce), while **acceptance** is announcement-scoped:

## Opening, restarting, deferring (local behavior)

- **Open** on the transport leave of the current controller; freeze the local view.
- **Another electorate member leaves mid-round** → restart locally: recompute, re-derive `roundId`, re-freeze, re-advertise.
- **A join mid-round** → deferred: no change to the frozen local view; the joiner bootstraps after the round closes.
- **Close** after `electionRoundMs` (plus the supersession window past the first applied announcement); `electionRoundRef.current = null`.

## Advertisement and adoption (at the local winner)

```text
non-winners → local round's winner: ELECTION_ADVERTISE(roundId, truncated state)
winner: collect for electionRoundMs; discard wrong-roundId, wrong-epoch, or
        semantically invalid entries
winner: adopted = chooseElectionState([own, ...advertised])
        // (sessionEpoch DESC, revision DESC, controllerPeerId ASC) — a stale
        // pre-switch session can never win regardless of revision (08)
winner: next = engine.changeController(adopted, selfId)
winner → all: CONTROLLER_CHANGED(roundId, departed, electorate, selfId,
              toSnapshotState(next))
```

Advertisements still use exact local-round matching — they only feed the local winner's adoption choice, so divergent views merely mean a candidate is missing from one winner's set, which the supersession order repairs. *(Advertisement provenance: crash-fault concession, 00.)*

## Announcement acceptance (replica side) — internally consistent + self-relevant

```ts
authorizeControllerChange(
  envelope: VisualNovelActionEnvelope,
  current: VisualNovelSessionState,
  transportPeerId: string,
  selfPeerId: string,
  connectedTransportPeerIds: string[],
  lastApplied: ElectionRound['applied'], // survives local round restarts
): { ok: true } | { ok: false; reason: string } {
  const payload = envelope.payload as VisualNovelPayloadByAction['CONTROLLER_CHANGED']
  // Structural (03) already guaranteed: controllerPeerId === state.controllerPeerId
  // === sender; electorate canonical (sorted, unique, departed excluded);
  // roundId digest binds the supplied fields; envelope/state consistency.

  // INTERNAL consistency: the announcer must be the winner of ITS OWN
  // canonical electorate. We do not require it to equal OUR electorate —
  // honest views differ; convergence comes from supersession below.
  if (payload.controllerPeerId !== this.electController(payload.electorate)) {
    return { ok: false, reason: 'not-winner-of-own-electorate' }
  }
  if (payload.controllerPeerId !== transportPeerId) {
    return { ok: false, reason: 'sender-mismatch' }
  }

  // SELF-RELEVANT conditions: this announcement must be about MY controller's
  // departure, and that peer must actually be gone from MY transport view.
  if (payload.departedControllerPeerId !== current.controllerPeerId) {
    return { ok: false, reason: 'wrong-departure' }
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

  // TOTAL supersession order ACROSS announcements (not per-roundId): epoch,
  // then revision, then lower winner ID. Every replica that eventually sees
  // both of two competing announcements picks the same one — this is what
  // converges B's {B,C} round and C's {C} round instead of mutual wrong-round.
  if (lastApplied) {
    const better =
      s.sessionEpoch > lastApplied.sessionEpoch ||
      (s.sessionEpoch === lastApplied.sessionEpoch && (
        s.revision > lastApplied.revision ||
        (s.revision === lastApplied.revision &&
          payload.controllerPeerId < lastApplied.controllerPeerId)))
    if (!better) return { ok: false, reason: 'superseded' }
  }
  return { ok: true }
}
```

Application (12) installs `payload.state` atomically, records `lastApplied` (kept for the supersession window even across local round restarts), and commits.

### The divergent-views scenario, replayed

- B freezes `{B, C}`, expects B; C freezes `{C}`, expects C. Both announce.
- B receives C's announcement: internally consistent (C = min of `{C}`), self-relevant (same departed controller, absent). B compares against its applied announcement (its own): equal epoch/revision → lower winner ID wins. If `B < C`, B keeps its own and C's is `superseded`; if `C < B`, B adopts C's.
- C receives B's announcement: same comparison, same total order, same outcome.
- Both replicas — and every bystander that sees both — converge on the identical winner without any join/leave event forcing a common round. During the window before both announcements propagate, each population follows its own applied announcement; that transient disagreement is exactly the liveness-under-stability concession of the threat model (00), and it self-resolves on delivery.

Note `not-in-electorate` is deliberately **not** a rejection reason: B not appearing in C's `{C}` view means C's observation was degraded, not dishonest. The self-relevant checks (my departed controller, actually absent) plus the total order carry convergence.

## Tests for this step

- **Round ID validity:** every generated `roundId` passes `isId` for electorates of 1–64 members (property test); the Revision 5 pipe-joined form is demonstrably rejected by `isId` (regression documentation test).
- **Digest binding:** an announcement whose `roundId` does not match its own fields is rejected structurally (03); tampering with the electorate after derivation is caught.
- **Divergent-views convergence (the reviewer scenario):** B freezes `{B,C}`, C freezes `{C}`, both announce — every delivery order converges all replicas on the same winner; no `wrong-round` deadlock; no join/leave needed.
- **Epoch resurrection blocked:** post-switch lagging `S1@20` advertisement loses at the winner (wrong epoch) and at the gate; no replica re-installs S1 — including after a full-room reload (persisted `latestEpoch`, 08/15).
- Frozen-local behavior: join mid-round defers (no acceptance split — acceptance no longer depends on the local electorate); member leave restarts the local round; winner crash → restarted round announces with new fields and supersedes by the total order.
- Non-winner-of-own-electorate, sender mismatch, wrong departure, departed-still-connected, adopted-state regression, post-application supersession (equal state → lower winner ID), replayed announcement = duplicate, missed-leave replica converges (self-relevant checks pass without any local round).
