# 00 — Architecture, threat model, and delivery plan

> **Revision 10 (2026-07-17).** Resolves the remaining Revision 9 convergence gaps: reconciliation history no longer terminally suppresses later stronger evidence; an ended epoch blocks every state-installing path and cancels matching recovery; high water dominates every durable historical record; metadata and canonical state are committed through one lock-scoped transaction; sequential controller departures retain a bounded migration lineage; conflict IDs are symmetric and self-verifying; the epoch outcome carries a durable comparator floor; current-epoch safety records are never trimmed; story identity is immutable within a session; stale retired checkpoints are discarded rather than blocking bootstrap; and retirement travels in an identity-safe structured notice.

## Step index

| Step | File | Contents |
| --- | --- | --- |
| 00 | this file | Guarantees, invariants, lifecycle, milestones |
| 01 | `01-config-and-limits.md` | Limits, epoch rules, canonical ordering and floors |
| 02 | `02-data-models.md` | Envelopes and durable/runtime records |
| 03 | `03-validation-runtime.md` | Structural and cross-record normalization |
| 04 | `04-validation-semantic.md` | Story/state semantic boundaries |
| 05 | `05-engine.md` | Pure transport-safe engine |
| 06 | `06-example-story.md` | Bundled example and catalog |
| 07 | `07-transport.md` | Existing-room transport adapter |
| 08 | `08-sync-authorization.md` | Gate, transactions, recovery authorization |
| 09 | `09-start-round.md` | Starts and symmetric reconciliation |
| 10 | `10-election-round.md` | Session-bound migration lineage |
| 11 | `11-session-termination.md` | ACKs, certificates, dispositions |
| 12 | `12-sync-hook-dispatch.md` | Runtime, dispatch, recovery, lifecycle |
| 13 | `13-react-ui-and-room-integration.md` | Bootstrap and rollback UI |
| 14 | `14-assets-and-audio.md` | Safe assets and local audio |
| 15 | `15-persistence.md` | Locked metadata/state transactions and checkpoints |
| 16 | `16-testing.md` | Regression matrices and failure mesh |
| 17 | `17-rollout.md` | Regression, CI, and rollout gates |

## Failure model

The MVP tolerates honest crashes, reloads, delay, duplication, replay, reordering, temporary partitions, missed lifecycle callbacks, and multiple same-origin tabs. It is not Byzantine fault tolerant. Unsigned decision, recovery, migration, disposition, and completed-end gossip are honest-peer concessions until signatures are added.

Guarantees:

1. **Integrity safety:** invalid, oversized, semantically impossible, stale, terminally retired, duplicate, or unauthorized input does not expose canonical state.
2. **Durable monotonic safety:** high water, the current epoch outcome and comparator floor, dispositions, completed-end certificates, start decision, and migration lineage survive reload.
3. **Eventual reconciliation:** while an epoch is active, any valid complete state may be compared even if its session previously lost a reconciliation. Once delivery stabilizes, every population chooses the same winner.
4. **Closed-epoch safety:** once the canonical high-water outcome is ended, no start, snapshot, reconcile, restart, migration, or recovery path can install state from that epoch.
5. **Termination dominance:** a validated completed-end certificate ends only its exact session, epoch, story ID, and story version.
6. **Cross-tab ordering:** no tab may install state after another tab has committed a newer metadata generation.

## Non-negotiable invariants

- Exactly one novella runtime per group room; direct-message room instances mount none.
- No second WebRTC room, microphone, central state API, account, analytics, or cloud progress store.
- Story content is declarative JSON; no executable code or raw HTML.
- Receiver order: normalize → outer identity → typed gate → semantic validation → authorization → lock-scoped metadata/state transaction → duplicate commit.
- No receiver attaches before RoomMeta, the latest checkpoint classification, story catalog, and strongest available baseline are ready.
- Same `(sessionId, sessionEpoch)` always has one immutable `(storyId, storyVersion)`.
- `updatedAt` never participates in distributed ordering.
- `EpochOutcome.floor` is advanced before every canonical state exposure.
- `reconciled` disposition is historical/UI evidence, not terminal suppression of full-state evidence while the epoch remains active.
- `ended` and `switched` are terminal for their exact session; a higher epoch terminally supersedes every older epoch.
- Active migration authority is a bounded lineage for the canonical session, not one replaceable record.
- Conflict IDs sort their state digests before derivation and can be verified by a peer that has not seen the conflict before.
- Current-high-water dispositions, certificates, and migration lineage entries are never trimmed. Bound exhaustion fails safely.
- Every durable historical epoch is `<= highWaterEpoch`.
- Holder-forwarded evidence uses a fresh outer envelope naming the holder.

## Lifecycle

1. **Start:** coordinator commits a revision-0 decision. A lock-scoped transaction creates the active outcome/floor and installs state.
2. **Progression:** controller serializes requests. Each accepted event updates the outcome floor and canonical state in one transaction before broadcast/commit.
3. **Reconciliation:** peers derive a symmetric conflict descriptor from both state digests. A stronger different session updates the outcome, decision, and nonterminal reconciliation disposition before install.
4. **Switch:** controller terminally retires the old session as `switched`, creates exactly the next epoch and outcome, then installs.
5. **Migration:** each controller departure appends one lineage entry. Delayed announcements from any retained entry remain full-state evidence and compare against current progress.
6. **End:** controller persists an `ended` disposition plus completed certificate, marks the outcome ended, cancels same-epoch conflicts/recoveries, and clears state.
7. **Reload:** bootstrap discards authoritative-stale checkpoints, restores safety metadata, and exact-recovers any missing active full state before interactivity.

## Milestones

- **M1:** models, validators, engine, bundled story, local UI.
- **M2:** complete bootstrap, starts, progression, exact recovery, comparator floor.
- **M3:** reconciliation, migration lineage, dispositions/certificates, lock-scoped transactions.
- **M4:** production rollback/end/retirement UI, accessibility, assets/audio.
- **M5:** adversarial mesh, multi-browser E2E, visible CI, README, optional signatures.

## Definition of done

- A previously losing session that later has the stronger valid state can still converge while the epoch is active.
- Ended high-water epochs reject all same-epoch state-installing actions and outstanding recovery responses.
- RoomMeta rejects any disposition/certificate/migration epoch above high water.
- A newer cross-tab generation prevents a stale post-write state install.
- Two or more sequential controller departures retain authorization for delayed earlier announcements.
- Opposite peers derive the same conflict ID and can create the conflict record from the first reconcile message.
- Reload without a checkpoint still has a durable comparator floor and exact recovery path.
- Current-epoch safety bounds fail closed rather than trimming evidence.
- Same-session story/version changes are rejected.
- Retired stale checkpoints do not block bootstrap.
- Retirement notices carry the exact normalized disposition.
