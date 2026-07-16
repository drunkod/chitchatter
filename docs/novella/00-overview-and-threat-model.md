# 00 — Architecture, scope, threat model, and delivery plan

> **Revision 6 (2026-07-16).** Sixth-review fixes: election/start round IDs are **bounded synchronous digests** that pass `isId` (the concatenated form was rejected by the validator it fed); the decided-epoch start guard is **actually implemented** with action-specific gating on the *embedded* session (the generic gate checked the bootstrap scope's `"bootstrap"` ID and `<` instead of `≤`); `START_COMMITTED` **always authorizes its sender** and same-epoch replacement is impossible once a session has progressed; partially delivered start decisions get **decision recovery** (retained commit gossip + a partition-heal rule) under an explicit **eventual-stability assumption** — the threat model now states plainly that safety is unconditional but liveness requires stabilization, because in a fully asynchronous crash model both cannot be promised; election announcements are accepted on **internally consistent round fields with convergent supersession**, not exact local-round equality (locally frozen views can legitimately differ); termination collects **`SESSION_END_ACK`s from a frozen recipient set**, finalizes only when the set is exhausted, and retains the end notice past finalization; **epoch and tombstone safety metadata persists** across reloads in room meta storage, separate from deletable checkpoints; the persistence sketch handles the async `crypto.subtle` digest; the engine authoring guarantee is reworded honestly; the test mesh gains per-peer link views, queued delivery, and partial-send crash points.
>
> **Revision 5 (2026-07-16).** Coordinated start rounds; room-monotonic `sessionEpoch`; frozen election rounds; termination protocol; engine transport-limit enforcement; pre-dispatch gate; `switchSession`; sync-owned participation ref; persistence wiring; `DataPayload` test-transport constraint.
>
> Step documents (three new protocol steps; later steps renumbered):
>
> | Step | File | Contents |
> | --- | --- | --- |
> | 00 | this file | Architecture, threat model, invariants, milestones |
> | 01 | `01-config-and-limits.md` | Protocol constants, byte-limit derivation, epochs |
> | 02 | `02-data-models.md` | Models, action/payload unions, round shapes |
> | 03 | `03-validation-runtime.md` | Normalizing structural validators |
> | 04 | `04-validation-semantic.md` | Story validation, session-vs-story, effect bounds |
> | 05 | `05-engine.md` | Pure engine (with transport-limit enforcement) + tests |
> | 06 | `06-example-story.md` | Bundled story + catalog |
> | 07 | `07-transport.md` | `network.ts`, `PeerRoom`, transport interface |
> | 08 | `08-sync-authorization.md` | Authorization matrix, sync service, pre-dispatch gate |
> | 09 | `09-start-round.md` | Coordinated start protocol, `switchSession` |
> | 10 | `10-election-round.md` | Frozen electorate elections, epoch-aware adoption |
> | 11 | `11-session-termination.md` | `SESSION_ENDED` protocol, tombstones, participation |
> | 12 | `12-sync-hook-dispatch.md` | Pre-dispatch gate, handlers, send path, flows |
> | 13 | `13-react-ui-and-room-integration.md` | Context, hook, persistence wiring, Room mounting |
> | 14 | `14-assets-and-audio.md` | Asset resolution/preload, local audio |
> | 15 | `15-persistence.md` | Checkpoints, latest pointer, integration contract |
> | 16 | `16-testing.md` | Test matrices, transport mesh |
> | 17 | `17-rollout.md` | Regression, manual matrix, rollout, command gate |

## Product outcome

Users who join the same existing Chitchatter room can keep voice and text chat active while reading one synchronized visual novel. A controller peer owns canonical progression; other peers request progression. All live story state travels over the existing peer-to-peer data channel.

## Threat model

Novella state synchronization is **crash-fault tolerant among honest room members**. It is *not* Byzantine fault tolerant in the MVP, and no document in this set may claim otherwise.

- Everyone in a Chitchatter room already shares the room secret and can read/write chat and join calls. The novella protocol treats room members as **cooperating but crash-prone**: peers may disconnect, lag, duplicate, reorder, or replay messages — with no maximum delivery delay assumed — and the protocol must stay **safe** despite that.
- **Safety vs. liveness, stated honestly.** In a fully asynchronous crash model, no protocol can guarantee both agreement safety and termination (FLP). This plan therefore promises: **safety unconditionally** — no delivery order, crash timing, or partition ever installs two diverging accepted outcomes that cannot be reconciled by the documented deterministic rules — and **liveness under eventual stability**: decisions (start commits, election announcements, termination completion) are guaranteed to disseminate and converge once membership and delivery stabilize for long enough for one retry cycle to complete. During instability, peers may transiently disagree; the reconciliation rules (decision recovery 09, announcement supersession 10, partition-heal 09) make every such disagreement self-resolving on stabilization. Every convergence claim in these documents is implicitly scoped by this assumption.
- Validation and authorization stop **accidental and structural** corruption and *casual* interference (a non-controller cannot progress, restart, end, or switch the story through any implemented path).
- A **deliberately malicious room member** can fabricate structurally valid state during the provenance-blind windows — bootstrap (null local state) and election advertisement — because the MVP does not cryptographically prove controller authorship. This residual risk is accepted; it is equivalent to the trust users already extend by sharing a room.

**Post-MVP hardening path (documented, not scheduled):** Chitchatter peers already exchange verified public keys (`services/Encryption`). A hardened protocol adds a controller signature over `digest(state)` to snapshot-class payloads and a signed canonical chain (`prevDigest` per event); election candidates then carry the last controller-signed digest. The envelope reserves a `proof` field for this.

## Current repository assessment

| File | Existing behavior (verified) | Novella change |
| --- | --- | --- |
| `src/components/Room/Room.tsx` | Renders group room and targeted DM rooms; DM dialogs are `keepMounted` `Room` instances | Mount `VisualNovelProvider` only when `!isDirectMessageRoom`; keep `RoomVideoDisplay` (`userId`, `width`, `height`) |
| `src/components/Room/useRoom.ts` | Creates/reuses `PeerRoom`; returns `peerRoom`; reports `isDirectMessageRoom` | Consume the returned `peerRoom` |
| `src/lib/PeerRoom/PeerRoom.ts` | Keyed lifecycle handlers (one per `PeerHookType`); `getPeers()` = connected remote transport IDs; action tuple `[sender, connectReceiver, progress]` | Add `getSelfId()`, keyed removal; satisfies `VisualNovelTransport` |
| `src/hooks/usePeerAction.ts` | Typed sender + one receiver | Carry the novella envelope over one action |
| `src/models/network.ts` | Numeric `PeerAction` enum; 12-char action-name limit | Add `VISUAL_NOVEL` only |
| `src/contexts/ShellContext.ts` | Peer list (`Peer.peerId` = transport ID), `peerRoomRef` | Read-only reference |
| `src/contexts/StorageContext.ts` | `getPersistedStorage()` → localforage (`setItem` resolves to stored value) | Checkpoint adapter, wired in 13/15 |
| `src/services/Encryption` | Peer public keys + signature verification | Unused in MVP; hook for signed digests |

## Non-negotiable invariants

- No central session/state API, message database, account system, analytics, or progress tracking. No second WebRTC room, no duplicate microphone stream.
- Exactly one novella provider and one replica per browser, in the group room only.
- Story data is declarative JSON; never `eval`/`new Function`/raw HTML.
- Every accepted envelope passes, in order: structural validation → normalization into fresh objects → transport identity check → **pre-dispatch gate (tombstone, duplicate, epoch)** → per-action authorization → semantic validation against the loaded story → application.
- **Engine output is transport-legal by construction:** the engine enforces variable count, aggregate bytes, and numeric finiteness, so a locally legal transition can never produce a state the network validator rejects (05).
- Sessions are totally ordered by room-monotonic **`sessionEpoch`**; elections and adoption order by `(sessionEpoch, revision)` — a higher revision from an older epoch can never win (10). **Epoch and tombstone metadata persists across reloads** in room meta storage (15) — it is protocol safety data, separate from deletable checkpoints, so an ended epoch-5 session cannot become "newer" after everyone refreshes.
- Sessions are **installed only by commit**: `START_COMMITTED` (fresh start, 09) from an authorized coordinator, controller `SESSION_STARTED` switch (09), authorized snapshots, or `CONTROLLER_CHANGED` (10). Local proposals never install, and no same-epoch commit can reset a session that has progressed past revision 0 (09).
- Ending a session is a protocol with **acknowledgements**: authority is retained until every member of the frozen recipient set has acked, left, or been reached by the retained end notice (11).
- Canonical progression deltas are replayed through the local engine before application. Duplicate-suppression commits only after success. Dispatch is exhaustive; unimplemented actions are rejected, never committed.
- Snapshots carry truncated history and byte-bounded variables so a legal state always fits `maxSnapshotBytes` (01/03).
- Chat history and story history are separate domains; asset bytes never travel in envelopes.

## Module graph

```text
Room.tsx (group room only)
  ├─ existing useRoom → existing PeerRoom → Trystero/WebRTC
  ├─ VisualNovelProvider (one per group room)
  │    ├─ useVisualNovel (composition; wires checkpoint hook + StorageContext)
  │    │    ├─ useVisualNovelAssets / useVisualNovelAudio
  │    │    ├─ useVisualNovelCheckpoint (15)
  │    │    ├─ VisualNovelEngine (pure, limit-enforcing)
  │    │    └─ useVisualNovelSync → VisualNovelTransport (PeerRoom)
  │    │         ├─ start rounds (09)   ├─ election rounds (10)
  │    │         └─ termination (11)    └─ dispatch gate (12)
  │    └─ VisualNovelContext
  ├─ VisualNovel UI
  ├─ existing RoomVideoDisplay / ChatTranscript / MessageForm / controls
```

## Controller model (summary)

1. **Fresh start (09):** a starter sends `START_PROPOSE` to the deterministic coordinator (lowest connected peer ID). The coordinator collects proposals for a bounded window, selects by `(controllerPeerId, sessionId)`, assigns `sessionEpoch = latestKnownEpoch + 1`, and broadcasts `START_COMMITTED` naming itself. **Only an authorized commit installs a session**; commit holders retain and gossip the commit, and a partially delivered decision reconciles by the documented same-epoch rules (progressed session wins; otherwise total order). Decided epochs are action-specifically gated (`≤`, against the *embedded* session) so delayed or replayed proposals can never reopen a round.
2. **Progression:** participants request; the controller serializes, runs the engine, applies locally, broadcasts at `revision + 1`; replicas replay and verify. Gaps recover via solicited snapshots.
3. **Story switch (09):** controller-only `switchSession` — tombstones the old session, increments the epoch, broadcasts `SESSION_STARTED` at the new epoch. Never enters fresh-start arbitration.
4. **Migration (10):** controller departure opens a locally frozen election round (bounded digest `roundId`). Advertisements flow to the local round's winner; adoption orders by `(sessionEpoch, revision)`. Announcements carry their raw round fields and are accepted on **internal consistency plus self-relevant conditions** — not exact equality with the local round, because honest views can differ — and competing internally valid announcements converge through a total supersession order.
5. **End (11):** the controller freezes the recipient set, broadcasts `SESSION_ENDED` at `revision + 1`, and **finalizes only when every recipient has acked (`SESSION_END_ACK`), left, or the set is exhausted**. The completed end notice is retained with the persistent tombstone and replayed to stale or reconnecting peers.

## Delivery milestones

- **M1 — Safe local engine.** Models; normalizing validators with aggregate byte limits; semantic story/session validation incl. effect-reachable variable bounds; **limit-enforcing engine**; bundled example; local lobby/stage. Exit: validator/engine matrices (16), including the engine-vs-validator consistency property.
- **M2 — P2P canonical progression.** Transport interface; pre-dispatch gate; exhaustive authorized dispatch; **coordinated start rounds**; requests + replayed events; send-failure repair; request timeout.
- **M3 — Recovery, migration, lifecycle.** Solicited bootstrap; checkpoints wired end-to-end; **epoch-aware frozen elections**; **termination protocol**; participation ref + rejoin; `switchSession`; `CONTROL_REQUEST`/`CONTROL_PASSED`.
- **M4 — Production UI.** Story/Video/Chat composition; status surfaces incl. start-round and pending-termination indicators; confirmation dialogs; local audio; accessibility.
- **M5 — Hardening.** Multi-context E2E; fuzz/negative suites; regression matrix (17); README/protocol docs; CI status checks for the new suites; *optional:* signed-digest provenance.

## Definition of done

- Two peers share identical session state; choices resolve through exactly one controller-approved event verified by replay.
- **Concurrent starts stay safe in every delivery order and converge under eventual stability** — only authorized commits install, a progressed session can never be reset by a same-epoch commit, and partially delivered decisions reconcile via commit gossip and the partition-heal rule (09).
- **No election can restore a session from an older epoch**, regardless of numeric revisions — including **after every peer reloads**, because the epoch high-water mark and tombstones persist in room meta storage (15).
- Election announcements are accepted only when internally consistent and self-relevant (10); honest divergent views (different locally frozen electorates) converge through the announcement supersession order instead of deadlocking on `wrong-round`.
- **A failed end-broadcast never silently strands the room:** the controller keeps state and authority until the frozen recipient set is exhausted (acks, departures, or retained-notice replay); an ended session cannot resurrect from delayed starts, restarts, checkpoints, or reloads.
- The engine cannot emit a transport-illegal **canonical** state; authored loops can still trip the engine's numeric/count guards as an explicit authoring/runtime error (04/05), but the "controller stuck beyond limits" deadlock is structurally impossible.
- Late join/refresh recovers via solicited semantic-validated snapshots; leave is durable (ref-backed — no rejoin race); rejoin bootstraps cleanly.
- Under the stated threat model, no structurally invalid, stale, duplicate, tombstoned, out-of-order, mismatched, oversized, semantically inconsistent, or unimplemented message can mutate state.
- Existing chat/voice/video/screen-share/file/DM flows regress clean; `npm test -- --run`, `npm run check:types`, `npm run lint`, `npm run build`, and focused E2E pass — with CI checks visible on the PR.

## MVP exclusions

Byzantine-fault provenance, graphical authoring, accounts, cloud saves, matchmaking, monetization, AI generation, CRDT multi-writer progression, mandatory custom asset transfer, large-room optimization.
