# 00 — Architecture, threat model, and delivery plan

> **Revision 9 (2026-07-17).** Corrects the remaining Revision 8 contradictions: progressed live/checkpoint state outranks revision-0 decision evidence; migration compares against current progress and is explicitly session-bound; a durable current-epoch outcome prevents a losing timeline from resurrecting after the winner ends; original end events bind their epoch and story identity; end re-acknowledgement survives reload; session retirement is separate from completed-end certificates; cross-tab metadata mutations execute against the latest stored value inside the lock; and tests cover each regression directly.

## Step index

| Step | File | Contents |
| --- | --- | --- |
| 00 | this file | Guarantees, invariants, lifecycle |
| 01 | `01-config-and-limits.md` | Limits, epochs, canonical ordering |
| 02 | `02-data-models.md` | Envelopes and durable records |
| 03 | `03-validation-runtime.md` | Structural and cross-record validation |
| 04 | `04-validation-semantic.md` | Story/state semantic validation |
| 05 | `05-engine.md` | Pure transport-safe engine |
| 06 | `06-example-story.md` | Bundled example and catalog |
| 07 | `07-transport.md` | Existing-room transport adapter |
| 08 | `08-sync-authorization.md` | Gate, metadata store, recovery |
| 09 | `09-start-round.md` | Starts and full-state reconciliation |
| 10 | `10-election-round.md` | Session-bound controller migration |
| 11 | `11-session-termination.md` | ACKs, certificates, retirement |
| 12 | `12-sync-hook-dispatch.md` | Dispatch and lifecycle |
| 13 | `13-react-ui-and-room-integration.md` | Bootstrap and rollback UI |
| 14 | `14-assets-and-audio.md` | Safe assets and local audio |
| 15 | `15-persistence.md` | Locked metadata and checkpoints |
| 16 | `16-testing.md` | Failure matrices and test mesh |
| 17 | `17-rollout.md` | Regression and rollout gates |

## Failure model

The MVP tolerates honest crash faults, delay, duplication, replay, reordering, reload, and temporary partitions. It is not Byzantine fault tolerant. Unsigned decision, recovery, election, and certificate gossip remain explicit honest-peer concessions until signatures are added.

Guarantees:

1. **Integrity safety:** invalid, oversized, semantically impossible, stale, retired, duplicate, or unauthorized messages do not expose canonical state.
2. **Durable monotonic safety:** high-water epoch, current epoch outcome, retirement records, completed-end certificates, active decision, and active migration survive reload.
3. **Eventual reconciliation:** partitions may progress competing timelines. Once delivery/membership stabilize, one locale-independent comparator selects a winner and losing novella actions visibly roll back.
4. **Closed-epoch safety:** when the canonical session for the high-water epoch ends, no other decision from that epoch can later install.
5. **Termination dominance:** a validated certificate ends only its exact session, epoch, story ID, and story version, even after controller migration or later progress on that same timeline.

## Non-negotiable invariants

- One novella runtime per group room; direct-message room instances mount none.
- No second WebRTC room, microphone, central state API, account, analytics, or cloud progress database.
- Story content is declarative JSON; no executable code or raw HTML.
- Receiver order: normalize → transport identity → typed gate → semantic validation → authorization → locked metadata mutation → atomic state change → duplicate commit.
- No receiver attaches until RoomMeta and the validated checkpoint baseline load.
- `updatedAt` never participates in distributed ordering.
- Full-state replacement compares against the strongest known same-epoch baseline: live state, checkpoint baseline, migration winner, then revision-0 start evidence.
- Session retirement and completed-end evidence are distinct. Switch/reconciliation retirement never fabricates an end certificate.
- The high-water `epochOutcome` identifies the canonical session and whether the epoch is active or ended.
- Active migration is bound to one session. Cross-session conflicts resolve through start reconciliation before migration; installing a different session clears the old migration and opens a new one only if its controller is absent.
- Metadata mutation functions execute inside the room-scoped storage lock against the latest validated stored record.
- Retained original envelopes are never forwarded directly. A holder sends a fresh gossip envelope naming itself.
- Recovery records bind request ID, target, kind, epoch, session, conflict/migration identity, and expiry.

## Lifecycle summary

1. **Start:** coordinator commits a revision-0 decision. Persist high water, active decision, and active epoch outcome before installation.
2. **Progression:** controller serializes requests and broadcasts exact-next-revision events; replicas replay.
3. **Reconciliation:** choose the best complete state. Persist the winning epoch outcome/decision and any losing-session retirement before state replacement.
4. **Switch:** retire the old session as `switched`, create the next epoch, and install its active outcome.
5. **Migration:** persist a session-bound departure record. Delayed announcements remain admissible, but never replace more advanced current state.
6. **End:** persist retirement plus a completed certificate and mark the canonical epoch ended. Any holder may later gossip the certificate.
7. **Reload:** restore metadata and checkpoint baseline before processing any novella message.

## Definition of done

- A rev1 conflicting decision cannot replace a rev10 checkpoint.
- A delayed migration announcement cannot replace more advanced current progress.
- Ending the canonical epoch prevents delayed losing decisions from resurrecting it.
- End certificates bind original session epoch/story and re-ACK survives recipient reload.
- Cross-session migration announcements are rejected until start reconciliation selects that session.
- Switch/reconciliation retirement works without an end envelope.
- Concurrent same-room tabs preserve the union of safety records.
- Failure tests model queued delivery, missed lifecycle events, partial send/crash, and reload races.
