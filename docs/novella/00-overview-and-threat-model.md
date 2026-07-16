# 00 — Architecture, threat model, and delivery plan

> **Revision 7 (2026-07-16).** Corrects the remaining Revision 6 contradictions: start proposals and start decisions now have different epoch gates; retained decisions travel inside a new identity-safe `START_DECISION_GOSSIP` envelope; same-epoch conflicts use one deterministic session-priority comparator and an explicit reconciliation state; election supersession retains the original migration identity and compares the full adopted state; duplicate end notices re-ack before tombstone handling; `RoomMeta` is normalized, restored completely, and loaded before receivers attach; React mounts the sync runtime only after the asynchronous room scope and safety metadata are ready; the test transport actually routes through its link network.

## Step index

| Step | File | Contents |
| --- | --- | --- |
| 00 | this file | Scope, guarantees, milestones |
| 01 | `01-config-and-limits.md` | Limits, epochs, deterministic IDs and state ordering |
| 02 | `02-data-models.md` | Models, envelopes, recovery records |
| 03 | `03-validation-runtime.md` | Normalizing structural validation |
| 04 | `04-validation-semantic.md` | Story and state semantic validation |
| 05 | `05-engine.md` | Pure, transport-safe engine |
| 06 | `06-example-story.md` | Bundled story and catalog |
| 07 | `07-transport.md` | Existing-room transport adapter |
| 08 | `08-sync-authorization.md` | Gate decisions and authorization matrix |
| 09 | `09-start-round.md` | Start decisions, gossip, and reconciliation |
| 10 | `10-election-round.md` | Controller migration and supersession |
| 11 | `11-session-termination.md` | End acknowledgements and retained notices |
| 12 | `12-sync-hook-dispatch.md` | Receiver lifecycle, handlers, recovery |
| 13 | `13-react-ui-and-room-integration.md` | Bootstrapped runtime and UI composition |
| 14 | `14-assets-and-audio.md` | Safe assets and local audio |
| 15 | `15-persistence.md` | Checkpoints and room safety metadata |
| 16 | `16-testing.md` | Matrices and failure-injection mesh |
| 17 | `17-rollout.md` | Regression, CI, and rollout gates |

## Product outcome

Members of one existing Chitchatter group room can keep text, voice, video, and file sharing active while reading one synchronized visual novel. One controller approves canonical progression; every peer validates and replays it locally.

## Threat and failure model

The MVP is **crash-fault tolerant among honest room members**, not Byzantine fault tolerant.

Peers may disconnect, duplicate, reorder, delay, replay, or temporarily partition messages. There is no fixed maximum delay. Deliberately malicious peers remain able to fabricate structurally valid bootstrap, reconciliation, or election state until post-MVP signatures are added.

The plan distinguishes three guarantees:

1. **Integrity safety — unconditional.** Invalid, oversized, semantically impossible, unauthorized, stale, tombstoned, duplicate, or unsupported messages do not mutate canonical state.
2. **Monotonic session safety — durable.** Persisted epochs and tombstones prevent an older or ended session from becoming current merely because browsers reload.
3. **Agreement and liveness — eventual-stability scoped.** During a real partition, honest populations may temporarily progress different same-epoch sessions. When connectivity and membership stabilize, a deterministic comparator selects one session and the losing side visibly reconciles. That can roll back losing-partition novella actions; the UI must show `reconciling` rather than pretending strict consensus existed. Strict no-rollback consensus is outside the MVP.

This is intentionally an **availability-with-deterministic-reconciliation** design. The documentation must not call transient split progression “unconditional agreement safety.”

## Post-MVP provenance hardening

Use existing peer public keys to sign a canonical digest chain:

- controller signs each canonical event and resulting state digest;
- start commits and controller changes carry the previous signed digest;
- reconciliation and election adopt only states descending from that chain.

The envelope retains a reserved `proof` field, but MVP validators discard it.

## Non-negotiable invariants

- One novella provider and one replica per group room; DM `Room` instances mount none.
- No second WebRTC room, microphone, central session API, account, analytics, or cloud progress store.
- Story content is declarative JSON; no raw HTML or executable code.
- Receiver order: normalize → transport identity → gate decision → semantic validation → action authorization → application → duplicate commit.
- Start proposals never install state. Only an authorized start decision or decision gossip can install/reconcile a fresh epoch.
- `START_PROPOSE` is stale at `candidate.epoch <= highWaterEpoch`; start decisions are stale only at `< highWaterEpoch`, allowing same-epoch recovery.
- Every solicited snapshot is bound to an outstanding request record containing the request ID, exact target peer, expected epoch, and recovery kind.
- Controller migration retains its original departed-controller identity through the whole supersession window.
- Termination finalizes only after every frozen recipient has acknowledged or left; completed end notices remain in persistent tombstones.
- `RoomMeta` is loaded and validated before any novella receiver attaches. A failed critical metadata write leaves novella read-only and surfaces an error.
- Engine output is always transport-legal. Authored numeric loops may fail one action with a clear authoring/runtime error but cannot strand the room in an untransmittable state.

## Controller lifecycle

1. **Fresh start:** proposals go to a locally selected coordinator. The coordinator emits `START_COMMITTED`. Any honest holder may forward the normalized decision using `START_DECISION_GOSSIP`; outer transport identity is the holder, not the original coordinator.
2. **Progression:** participants request; controller serializes, runs the engine, applies locally, and broadcasts the exact next revision. Replicas replay before applying.
3. **Same-epoch reconciliation:** compare `(revision, controllerPeerId, sessionId, canonicalState)` deterministically. The winning full state arrives through an explicit reconciliation action or an exact-target solicited snapshot. Losing peers display reconciliation and replace atomically.
4. **Story switch:** current controller tombstones the old session and creates exactly `epoch + 1` through `SESSION_STARTED`.
5. **Migration:** controller departure creates a migration record keyed by departed peer and epoch. Competing announcements are ordered by full state priority while that record remains open.
6. **End:** controller freezes recipients, repeatedly sends one `SESSION_ENDED`, gathers `SESSION_END_ACK`, then stores the completed end notice in `RoomMeta` and clears the live checkpoint.

## Milestones

- **M1 — Local safety:** models, validators, engine, bundled story, local UI.
- **M2 — Canonical progression:** transport, bootstrapped receiver, starts, requests, replay, exact-target recovery.
- **M3 — Lifecycle:** reconciliation, migration, termination, participation, checkpoints, persistent room metadata.
- **M4 — Production UI:** story/video/chat layout, conflict and termination states, accessibility, audio.
- **M5 — Hardening:** adversarial mesh tests, multi-browser E2E, visible CI, README, optional signed chain.

## Definition of done

- Normal connected operation produces identical state on all peers after each canonical event.
- Concurrent starts converge after delivery stabilizes; same-epoch decisions are not blocked by the epoch gate and cannot reset a progressed session merely because a revision-0 commit arrives.
- Retained decisions and reconciliation messages pass transport identity validation because the forwarder is represented by the outer envelope.
- Controller-change supersession remains authorized after the first announcement and is total over full state, not only epoch/revision/controller.
- Lost termination acknowledgements recover through duplicate-end re-acknowledgement.
- A full-room reload restores the epoch high-water mark, tombstones, retained end notices, and retained start decision before network processing starts.
- The failure-injection mesh can model one-way links, divergent peer views, queued/reordered/dropped delivery, partial broadcast followed by crash, and send-resolves-before-delivery.
- `npm test -- --run`, `npm run check:types`, `npm run lint`, `npm run build`, and focused E2E run as visible CI checks.
