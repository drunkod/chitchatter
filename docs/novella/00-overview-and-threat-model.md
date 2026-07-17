# 00 — Architecture, threat model, and delivery plan

> **Revision 12 (2026-07-17).** Resolves the remaining Revision 11 gaps: canonical state bytes now follow RFC 8785/JCS exactly; every epoch transition retains a durable certificate so A→B→C and ended-successor recovery remain provable; safety-lock recovery has an explicit lock-kind matrix and pre-gate protocol; migration advertisements identify their exact lineage record; controller rejoin does not revoke retained migration evidence; every below-high-water peer receives bounded supersession evidence even after disposition trimming; capacity locks have reserved durable storage; checkpoint pointers are generation-fenced; and floor-only reconciliation has a defined floor-evidence response.

## Step index

| Step | File | Contents |
| --- | --- | --- |
| 00 | this file | guarantees, threat model, lifecycle, milestones |
| 01 | `01-config-and-limits.md` | RFC 8785 bytes, digest ordering, epochs, safety locks |
| 02 | `02-data-models.md` | envelopes, transition certificates, evidence, locks |
| 03 | `03-validation-runtime.md` | structural normalization and cross-record invariants |
| 04 | `04-validation-semantic.md` | story/state/floor/transition/checkpoint semantics |
| 05 | `05-engine.md` | pure deterministic novella engine |
| 06 | `06-example-story.md` | bundled story and fixtures |
| 07 | `07-transport.md` | existing-room transport and identity |
| 08 | `08-sync-authorization.md` | gate, supersession, recovery, rebasing |
| 09 | `09-start-round.md` | starts, reconciliation, epoch transitions |
| 10 | `10-election-round.md` | lineage-bound migration elections |
| 11 | `11-session-termination.md` | ACKs, end evidence, dispositions |
| 12 | `12-sync-hook-dispatch.md` | runtime, dispatch, refresh, safety recovery |
| 13 | `13-react-ui-and-room-integration.md` | coherent bootstrap and safety UI |
| 14 | `14-assets-and-audio.md` | safe assets and local audio |
| 15 | `15-persistence.md` | locked transactions, reserves, checkpoints |
| 16 | `16-testing.md` | regression/property/failure matrices |
| 17 | `17-rollout.md` | rollout and acceptance gates |

## Failure model

The MVP tolerates honest crashes, reloads, delay, duplication, replay, reordering, temporary partitions, missed lifecycle callbacks, multiple same-origin tabs, trimmed informational history, and lost generation notifications. It is not Byzantine fault tolerant. Holder gossip and transition evidence are unsigned honest-peer concessions until signatures are introduced.

Guarantees:

1. **One total ordering:** full-state and floor-only peers compare the same RFC 8785 SHA-256 tuple.
2. **Durable epoch provenance:** every committed epoch has exactly one retained transition certificate until explicit reset.
3. **Eventual supersession:** any valid below-high-water traffic receives current transition/outcome evidence rather than a silent drop.
4. **Closed-epoch safety:** an ended high-water outcome blocks every same-epoch install path and cancels matching operations.
5. **Cross-tab safety:** metadata and canonical state install under one room lock; checkpoint publication is generation-fenced.
6. **Fail-closed capacity:** normal metadata leaves fixed emergency headroom, so a durable capacity lock can always be written.
7. **Recoverable safety policy:** each safety-lock kind has exactly defined local or remote recovery authority.

## Non-negotiable invariants

- Exactly one novella runtime per group room; direct-message rooms mount none.
- No second WebRTC room, media capture, account system, analytics, cloud progress store, or raw HTML story content.
- State digest input is the RFC 8785 canonical JSON serialization of the normalized semantic state defined in 01.
- Same `(sessionId, sessionEpoch)` has immutable `(storyId, storyVersion)`.
- State priority is `(epoch, revision, lower controller ID, lower session ID, lower SHA-256 digest)`.
- Every epoch from 1 through `highWaterEpoch` has one contiguous `EpochTransitionCertificate` unless metadata was explicitly reset.
- A switch disposition references the transition certificate that created its immediate successor; later holders send the remaining transition chain to current high water.
- `activeOrigin` is derivable from the final transition certificate and may be cleared on end without losing historical provenance.
- `ended` is terminal only with its exact completed-end certificate; `reconciled` is nonterminal at active high water.
- Retained migration authority is selected by `migrationId`; current peer presence does not revoke an already-open record.
- Every authenticated below-high-water message receives supersession/end evidence, even if its exact disposition was trimmed.
- Critical writes and coherent reads require room-scoped Web Lock semantics; there is no unlocked fallback.

## Lifecycle

1. **Initial start:** persist transition certificate for epoch 1, outcome/floor, origin, and revision-0 state in one transaction.
2. **Progression:** accepted engine transition and new floor install atomically; checkpoint side effects are generation-fenced.
3. **Reconciliation:** exact descriptors apply; stale descriptors rebase against latest full state or floor. Logical reconciliation history upserts.
4. **New epoch:** coordinated start after an ended epoch or controller switch persists one contiguous transition certificate and the new outcome/origin/state.
5. **Migration:** controller departure appends one lineage record. Advertisements and announcements identify that exact record.
6. **End:** persist ended disposition and certificate, mark outcome ended, clear active origin/lineage, cancel operations, install null.
7. **Stale peer:** reply with a bounded transition chain plus current active or ended outcome evidence.
8. **Safety recovery:** capacity locks may clear only through a verified higher-epoch transition chain or explicit reset; other lock kinds use their defined local recovery path.
9. **Reload:** read emergency lock plus metadata/checkpoint as one coherent bootstrap snapshot before installing a receiver.

## Milestones

- **M1:** models, RFC 8785 canonicalizer, validators, engine, bundled story.
- **M2:** coherent bootstrap, transitions, starts, progression, floor-only and supersession recovery.
- **M3:** rebasing reconciliation, migration lineage, end/disposition evidence, safety recovery, locked persistence.
- **M4:** rollback/end/supersession/safety UI, accessibility, assets/audio.
- **M5:** adversarial mesh, multi-browser E2E, visible CI, README, optional signed evidence.

## Definition of done

- RFC 8785 fixtures match browser and Node byte-for-byte, including strings, `-0`, and exponent cases.
- A→B→C and A→B→B-ended both recover an A peer using retained transition evidence.
- Every safety-lock kind accepts only its documented recovery mechanism.
- Two retained migration records can run interleaved advertisements without ambiguity.
- A departed controller rejoining does not invalidate an earlier lineage announcement.
- A stale peer still learns current outcome after its disposition was trimmed and lifecycle callbacks were suppressed.
- Metadata-byte exhaustion can still persist a durable capacity lock.
- A generation-10 checkpoint cannot replace the generation-11 latest pointer.
- A floor-only receiver that beats incoming state returns floor evidence and starts canonical recovery.
