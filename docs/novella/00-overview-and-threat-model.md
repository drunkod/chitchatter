# 00 — Architecture, threat model, and delivery plan

> **Revision 13 (2026-07-17).** Resolves the remaining Revision 12 gaps: transition certificates now prove only immutable epoch origin while current outcomes may progress or end; supersession and safety recovery use compact paginated proof pages rather than oversized single envelopes; start-after-ended transitions embed their terminal predecessor proof; transition-capacity locks are explicitly reset-only; migration elections use one stable round ID plus a canonical advertisement transcript; every safety-critical derived ID uses one RFC 8785/SHA-256 contract; and checkpoint blobs are immutable generation-specific records.

## Step index

| Step | File | Contents |
| --- | --- | --- |
| 00 | this file | guarantees, threat model, lifecycle, milestones |
| 01 | `01-config-and-limits.md` | JCS, protocol IDs, ordering, proof bounds, lock policy |
| 02 | `02-data-models.md` | compact transitions, paginated proofs, election transcripts |
| 03 | `03-validation-runtime.md` | structural normalization and cross-record invariants |
| 04 | `04-validation-semantic.md` | state, outcome dominance, transition, checkpoint semantics |
| 05 | `05-engine.md` | pure deterministic novella engine |
| 06 | `06-example-story.md` | bundled story and canonical fixtures |
| 07 | `07-transport.md` | existing-room transport and page delivery |
| 08 | `08-sync-authorization.md` | gate, proof assembly, safety recovery, rebasing |
| 09 | `09-start-round.md` | starts, reconciliation, immutable transition origins |
| 10 | `10-election-round.md` | transcript-bound controller migration |
| 11 | `11-session-termination.md` | end evidence, compaction, stale-peer replies |
| 12 | `12-sync-hook-dispatch.md` | runtime, proof assembly, recovery, refresh |
| 13 | `13-react-ui-and-room-integration.md` | coherent bootstrap and proof/safety UI |
| 14 | `14-assets-and-audio.md` | safe assets and local audio |
| 15 | `15-persistence.md` | locked metadata, immutable checkpoints, reserve policy |
| 16 | `16-testing.md` | regression, property, transport, and failure matrices |
| 17 | `17-rollout.md` | rollout and acceptance gates |

## Failure model

The MVP tolerates honest crashes, reloads, delay, duplication, replay, reordering, temporary partitions, missed lifecycle callbacks, page loss, page duplication, multiple same-origin tabs, compacted informational history, and lost generation notifications. It is not Byzantine fault tolerant. Unsigned holder evidence remains an explicit honest-peer concession until signatures are added.

Guarantees:

1. **One distributed ordering:** every complete-state and floor comparison uses the same RFC 8785 SHA-256 tuple.
2. **Canonical epoch provenance:** each epoch slot has one compact certificate proving the canonical revision-0 origin; historical slots are sealed.
3. **Mutable active slot and outcome:** same-epoch different-session reconciliation may replace only the active high-water slot, while progression/end advance or close the outcome without rewriting that winning origin certificate.
4. **Bounded supersession:** stale peers recover through independently bounded proof pages plus a separate state snapshot.
5. **Closed-epoch safety:** an ended high-water outcome blocks every same-epoch install path.
6. **Cross-tab safety:** metadata/state install share one room lock; checkpoint blobs and pointers are generation-fenced.
7. **Cause-specific fail-closed behavior:** every durable safety-lock code has one explicit recovery policy.

## Non-negotiable invariants

- Exactly one novella runtime per group room; direct-message rooms mount none.
- No second WebRTC room, media capture, account system, analytics, cloud progress store, or executable story content.
- Same `(sessionId, sessionEpoch)` has immutable `(storyId, storyVersion)`.
- State priority is `(epoch, revision, lower controller ID, lower session ID, lower SHA-256 state digest)`.
- All safety-critical derived IDs use the domain-separated JCS/SHA-256 function in 01.
- `EpochTransitionCertificate.successorOriginFloor` is revision-0 origin evidence.
- A historical transition slot is immutable. The active high-water slot may be replaced only by an authorized different-session reconciliation winner at the same epoch.
- Current outcome must match the current final transition subject and dominate its origin floor; it need not equal the origin outcome.
- `start-after-ended` transition embeds the exact predecessor completed-end certificate it relies on.
- Supersession pages never carry a full current state. Full state travels separately through authorized snapshot recovery.
- Every page is tied to one proof manifest, sender, request, page digest chain, and final current-evidence fingerprint.
- A migration round ID is stable for one retained lineage record; advertisement IDs and transcript IDs are separate.
- Historical end evidence embedded in transitions is never invalidated by compaction of standalone arrays.
- Transition-count exhaustion is reset-only. Other capacity codes may accept higher-epoch recovery only when preflight compaction and byte checks succeed.
- Checkpoint state blobs are immutable and keyed by session, generation, and floor digest.

## Lifecycle

1. **Initial start:** commit epoch-1 compact transition, active outcome/floor, origin reference, and state atomically.
2. **Progression:** update current outcome floor and canonical state without mutating the epoch transition.
3. **Reconciliation:** exact descriptors apply; stale descriptors rebase. A different-session winner atomically replaces only the active high-water transition slot and canonical switched evidence.
4. **New epoch:** switch or start-after-ended appends exactly one compact transition and installs revision-0 successor state.
5. **Migration:** open a lineage record, collect advertisements under one stable round ID, and validate a canonical transcript before controller change.
6. **End:** persist current completed-end evidence, mark outcome ended, clear active origin/lineage, and install null.
7. **Stale-peer recovery:** assemble paginated transition proof, adopt the final outcome/floor, then recover the full state separately if active.
8. **Safety recovery:** only recoverable capacity codes accept a strictly higher paginated proof; transition-limit and digest-collision remain reset-only.
9. **Reload:** coherently read emergency state, metadata, pointer, and immutable checkpoint before attaching an installing receiver.

## Milestones

- **M1:** JCS canonicalizer, exact ID derivation, models, validators, engine, bundled story.
- **M2:** coherent bootstrap, compact transitions, proof pagination, starts, progression, floor/snapshot recovery.
- **M3:** rebasing reconciliation, transcript migration, end evidence, safety recovery, locked persistence.
- **M4:** rollback/end/proof/safety UI, accessibility, assets/audio.
- **M5:** adversarial mesh, multi-browser E2E, visible CI, README, optional signatures.

## Definition of done

- A progressed or ended successor validates against its immutable revision-0 transition by identity and floor dominance.
- Maximum legal transition and snapshot sizes never require an envelope above `maxEnvelopeBytes`.
- Multi-page proofs tolerate reorder, duplicate, loss, retry, and stale-current-evidence replacement.
- Start-after-ended transitions remain independently valid after historical certificate compaction.
- Transition-count capacity lock cannot falsely advertise remote recovery.
- Two or more election advertisements share one round and produce a deterministic transcript/winner.
- Browser and Node derive identical transition, conflict, migration, advertisement, transcript, decision, and proof IDs.
- A delayed old checkpoint write cannot overwrite either the newer pointer or the newer referenced blob.
