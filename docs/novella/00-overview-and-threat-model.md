# 00 — Architecture, threat model, and delivery plan

> **Revision 8 (2026-07-17).** Closes the remaining Revision 7 recovery and durability gaps: completed end notices now travel in an identity-safe `SESSION_END_NOTICE_GOSSIP` envelope; migration authority is persisted and never expires merely because a local timer elapsed; metadata and the validated checkpoint baseline load before any receiver attaches; canonical replacement persists safety metadata before exposing state; all convergence ordering is locale-independent byte ordering; equal-revision divergence inside one session reconciles; RoomMeta mutations are serialized; recovery authorization is kind-specific and request-scoped; metadata validation enforces cross-field invariants; and the failure-injection mesh drops post-crash deliveries and routes lifecycle visibility through its link model.

## Step index

| Step | File | Contents |
| --- | --- | --- |
| 00 | this file | Scope, guarantees, milestones |
| 01 | `01-config-and-limits.md` | Limits, epochs, canonical byte ordering |
| 02 | `02-data-models.md` | Models, envelopes, durable protocol records |
| 03 | `03-validation-runtime.md` | Normalizing structural and metadata validation |
| 04 | `04-validation-semantic.md` | Story and full-state semantic validation |
| 05 | `05-engine.md` | Pure, transport-safe engine |
| 06 | `06-example-story.md` | Bundled story and catalog |
| 07 | `07-transport.md` | Existing-room transport adapter |
| 08 | `08-sync-authorization.md` | Gate, metadata queue, and authorization |
| 09 | `09-start-round.md` | Start decisions, gossip, and reconciliation |
| 10 | `10-election-round.md` | Durable controller migration and supersession |
| 11 | `11-session-termination.md` | End acknowledgements and certificate gossip |
| 12 | `12-sync-hook-dispatch.md` | Receiver lifecycle, handlers, exact recovery |
| 13 | `13-react-ui-and-room-integration.md` | Full bootstrap and rollback UI |
| 14 | `14-assets-and-audio.md` | Safe assets and local audio |
| 15 | `15-persistence.md` | Checkpoints and serialized room metadata |
| 16 | `16-testing.md` | Matrices and failure-injection mesh |
| 17 | `17-rollout.md` | Regression, CI, and rollout gates |

## Product outcome

Members of one existing Chitchatter group room keep chat, voice, video, screen share, and file transfer active while reading a synchronized visual novel. One controller approves normal progression; every peer validates and replays canonical events locally.

## Failure model and guarantees

The MVP tolerates honest crash faults, delay, replay, duplication, reordering, and temporary partitions. It is not Byzantine fault tolerant. Unsigned bootstrap, recovery, election, and retained-certificate gossip are explicit honest-peer concessions until post-MVP signatures are added.

The guarantees are deliberately separated:

1. **Integrity safety, unconditional:** invalid, oversized, semantically impossible, unauthorized, stale, tombstoned, duplicate, and unsupported messages do not mutate canonical state.
2. **Durable monotonic safety:** persisted high-water epochs, tombstones, active start decisions, and active migration records survive reloads and prevent old sessions or old controller departures from being mistaken for new ones.
3. **Agreement and liveness under eventual stability:** partitions may create competing same-epoch timelines. Once delivery and membership stabilize, every peer uses one locale-independent total ordering over normalized semantic state. The loser visibly rolls back. Strict no-rollback consensus is outside MVP.
4. **Termination dominance:** a validated completed-end certificate for `(sessionId, epoch)` ends that same session even if peers migrated its controller or progressed after missing the original end. It never ends a different session or a higher epoch.

## Non-negotiable invariants

- Exactly one novella provider per group-room page; DM room instances mount none.
- No second WebRTC room, central state service, account, analytics, or cloud progress database.
- Story packages are declarative JSON; no raw HTML or executable content.
- Receiver order: structural normalization → transport identity → typed gate → semantic validation → action authorization → awaited safety-metadata mutation → atomic state application → duplicate commit.
- No receiver attaches until room scope, validated RoomMeta, and validated latest checkpoint baseline are loaded.
- Start proposals never install. Same-epoch start decisions and gossip remain admissible for recovery.
- Every full-state replacement uses the shared comparator, including equal-revision divergence inside the same session.
- Active migration authority persists until its session ends or a higher epoch installs; retry timers never change authorization.
- Retained original envelopes are never forwarded directly by another peer. Holder gossip always has a new outer envelope naming the holder.
- RoomMeta mutations are serialized and built from the latest validated metadata; state is not exposed before the write succeeds.
- Recovery requests are stored by action ID and bind exact target, expected epoch/session, recovery kind, conflict identity, and expiry.
- Engine output is transport-legal; authored numeric loops can reject one transition before mutation but cannot create an untransmittable canonical state.

## Lifecycle summary

1. **Fresh start:** coordinator collects `START_PROPOSE`, emits `START_COMMITTED`, and persists the winning start decision before installation. Holders use `START_DECISION_GOSSIP`.
2. **Progression:** participants request; controller serializes, runs the engine, applies, and broadcasts exact-next-revision events. Replicas replay.
3. **Reconciliation:** complete normalized states are compared bytewise after epoch/revision and stable ID tie-breaks. A winning replacement is persisted first, then installed with visible rollback UI.
4. **Story switch:** controller tombstones the old session and installs exactly `epoch + 1`, clearing old start/migration records.
5. **Migration:** controller departure creates a persisted `MigrationRecord`. Competing announcements for that departure remain comparable until end or higher epoch.
6. **End:** controller gathers ACKs. Any tombstone holder can later send `SESSION_END_NOTICE_GOSSIP`; its embedded certificate dominates same-session/same-epoch migration and progression.

## Milestones

- **M1:** models, validators, engine, bundled story, local UI.
- **M2:** bootstrapped receiver, starts, progression, exact-target recovery.
- **M3:** reconciliation, durable migration, termination certificates, participation, persistence.
- **M4:** production layout, conflict/rollback/termination UI, accessibility, audio.
- **M5:** adversarial mesh, multi-browser E2E, visible CI, README, optional signatures.

## Definition of done

- Connected operation produces identical state after each canonical event.
- Partial start commits recover after coordinator crash without forwarding an invalid original envelope.
- Equal-revision divergent states, including the same session ID, converge deterministically.
- Delayed migration announcements remain authorized after timers and reloads.
- A retained completed-end certificate can be forwarded by any holder and ends only its exact `(sessionId, epoch)`.
- Full reload restores all safety records and the checkpoint baseline before processing network messages.
- Critical writes are serialized; failed writes leave novella read-only and do not expose the new state.
- The mesh models one-way views, delayed lifecycle events, drops, reorder, partial broadcast/crash, and send-resolves-before-delivery.
- Unit, type, lint, build, and focused E2E checks are visible on implementation PRs.
