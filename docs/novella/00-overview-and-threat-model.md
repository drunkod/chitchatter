# 00 — Architecture, threat model, and delivery plan

> **Revision 11 (2026-07-17).** Resolves the remaining Revision 10 gaps: canonical full-state and floor ordering now use the same explicitly specified SHA-256 digest; switched-session notices carry validated successor outcome/origin evidence; an ended disposition is terminal only with its exact certificate; stale conflict descriptors rebase against the receiver’s latest canonical baseline; bootstrap reads metadata and checkpoint from one stable generation; disposition records upsert by deterministic logical key; current-epoch capacity exhaustion enters a room-wide novella safety lock; Web Lock unavailability never falls back to unsafe writes; and lost generation notifications are repaired on focus and before every state-changing action.

## Step index

| Step | File | Contents |
| --- | --- | --- |
| 00 | this file | Guarantees, invariants, lifecycle, milestones |
| 01 | `01-config-and-limits.md` | Limits, digest, ordering, terminality, safety lock |
| 02 | `02-data-models.md` | Envelopes, origins, evidence, conflicts, lineage |
| 03 | `03-validation-runtime.md` | Structural and cross-record normalization |
| 04 | `04-validation-semantic.md` | Story, state, floor, checkpoint semantics |
| 05 | `05-engine.md` | Pure transport-safe engine |
| 06 | `06-example-story.md` | Bundled example and catalog |
| 07 | `07-transport.md` | Existing-room transport adapter |
| 08 | `08-sync-authorization.md` | Gate, transactions, recovery, rebasing |
| 09 | `09-start-round.md` | Starts, reconciliation, switch successor evidence |
| 10 | `10-election-round.md` | Session-bound migration lineage |
| 11 | `11-session-termination.md` | ACKs, certificates, dispositions |
| 12 | `12-sync-hook-dispatch.md` | Runtime, dispatch, refresh, lifecycle |
| 13 | `13-react-ui-and-room-integration.md` | Consistent bootstrap and safety UI |
| 14 | `14-assets-and-audio.md` | Safe assets and local audio |
| 15 | `15-persistence.md` | Locked transactions and coherent bootstrap reads |
| 16 | `16-testing.md` | Regression, property, and failure matrices |
| 17 | `17-rollout.md` | Regression, CI, and rollout gates |

## Failure model

The MVP tolerates honest crashes, reloads, delay, duplication, replay, reordering, temporary partitions, missed lifecycle callbacks, multiple same-origin tabs, and lost generation notifications. It is not Byzantine fault tolerant. Unsigned holder gossip and recovery evidence remain explicit honest-peer concessions until signatures are introduced.

Guarantees:

1. **Integrity safety:** invalid, oversized, semantically impossible, stale, terminally disposed, duplicate, or unauthorized input never exposes canonical novella state.
2. **One total ordering:** every peer, including floor-only peers, uses the same priority tuple and the same SHA-256 digest tie-break.
3. **Durable monotonic safety:** high water, outcome/floor, session origin, dispositions, end certificates, and migration lineage survive reload.
4. **Eventual reconciliation:** while the epoch is active, any valid complete state may compete, including a previously losing timeline that later progressed farther.
5. **Closed-epoch safety:** an ended high-water outcome blocks all same-epoch installation and cancels recovery/conflicts.
6. **Cross-tab safety:** metadata and canonical-store installation share one room lock; stale generations cannot act or install.
7. **Fail-closed capacity:** current-epoch safety evidence is never trimmed. Exhaustion disables novella mutation until a verified higher epoch or explicit reset.

## Non-negotiable invariants

- Exactly one novella runtime per group room; direct-message rooms mount none.
- No second WebRTC room, media capture, central state API, account, analytics, or cloud progress store.
- Story packages are declarative JSON with no executable code or raw HTML.
- Same `(sessionId, sessionEpoch)` has one immutable `(storyId, storyVersion)`.
- State priority is `(epoch, revision, lower controller ID, lower session ID, lower SHA-256 state digest)`.
- The SHA-256 input, domain separator, canonical bytes, hexadecimal encoding, and collision behavior are specified in 01.
- `EpochOutcome.floor` advances in the same transaction as every canonical state exposure.
- `activeOrigin` proves how the canonical session began, whether by coordinated start or controller-authorized `SESSION_STARTED` switch.
- A standalone switched disposition is never merged into a stale active outcome; it carries successor evidence and raises the receiver to that successor outcome atomically.
- `reconciled` dispositions are nonterminal at the active high-water epoch.
- `ended` is terminal only with an exact matching completed-end certificate.
- Conflict descriptors are symmetric but not frozen authorization. If the receiver progressed, the incoming state is rebased against the latest baseline.
- Bootstrap metadata, pointer, and checkpoint are classified from a stable generation.
- Critical writes require room-scoped Web Lock semantics. No unsafe fallback exists.
- Every state-changing UI action refreshes the latest generation before authority checks and send.

## Lifecycle

1. **Start:** coordinator commits revision-0 state. One transaction creates high water, active outcome/floor, `activeOrigin`, and canonical state.
2. **Progression:** controller serializes requests. The accepted transition and new floor install atomically before broadcast/duplicate commit.
3. **Reconciliation:** peers exchange complete states plus symmetric descriptors. Exact descriptors apply directly; stale descriptors rebase to the receiver’s current state and produce a fresh descriptor or winner.
4. **Switch:** controller creates exactly the next epoch. The old session receives a switched disposition; the new outcome, origin, floor, and state install atomically.
5. **Migration:** each controller departure appends one lineage entry. Delayed earlier-lineage announcements remain comparable.
6. **End:** controller persists ended disposition plus certificate, marks outcome ended, clears origin/lineage, cancels same-epoch operations, and installs null.
7. **Reload:** a stable-generation bootstrap snapshot initializes the canonical store or floor-only recovery before receiver attachment.
8. **Capacity/capability failure:** the novella enters a persistent read-only safety state while chat, media, screen share, and files remain available.

## Milestones

- **M1:** models, validators, engine, bundled story, local UI.
- **M2:** coherent bootstrap, digest/floor, start, progression, exact recovery.
- **M3:** rebasing reconciliation, migration lineage, dispositions/certificates, lock-scoped transactions.
- **M4:** production rollback/end/safety-capacity UI, accessibility, assets/audio.
- **M5:** adversarial mesh, multi-browser E2E, visible CI, README, optional signatures.

## Definition of done

- Full-state peers and floor-only peers choose the same winner for every priority tie.
- A switched notice arriving before successor state can be persisted and recovered without contradiction.
- Ended disposition without certificate never suppresses live state.
- Reconcile/migration envelopes created at rev10 still converge when the receiver is rev11.
- Bootstrap retries instead of blocking when metadata changes between reads.
- Repeated logical reconciliation upserts one disposition record.
- Safety-bound overflow disables all novella mutation and installation.
- Unsupported/denied Web Locks expose a clear read-only capability error.
- A crash before generation publication is repaired on focus or before the next novella action.
