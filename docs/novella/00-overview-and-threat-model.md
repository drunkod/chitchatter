# 00 — Architecture, threat model, and delivery plan

> **Revision 4 (2026-07-16).** Fourth-review fixes: an **explicit threat model** (crash-fault-tolerant among honest room members for MVP; signed-state hardening documented as post-MVP) replacing over-claims about fabricated state; `CONTROLLER_CHANGED` now carries the adopted snapshot and applies atomically inside an explicit **election round** keyed by the departed controller (fixing both the content-less revision jump and the supersession deadlock); a bounded **start-arbitration phase** replaces the racy revision-0 collision rule; `SESSION_ENDED` requires exact-next revision and leaves a **tombstone**, and participants get a durable `Participation` state so leaving actually leaves; `validateEnvelope` **constructs a fresh normalized envelope** instead of casting the untrusted input; snapshot byte limits are now enforced with aggregate `maxVariablesBytes`/`maxHistoryBytes` so a legal state cannot exceed `maxSnapshotBytes` even with worst-case encodings; snapshots are validated **semantically against the story** before application; the video JSX supplies the real `RoomVideoDisplay` props; the test mesh inserts before notifying and returns a mutable tuple.
>
> The plan is split into focused step documents:
>
> | Step | File | Contents |
> | --- | --- | --- |
> | 00 | this file | Architecture, threat model, invariants, milestones |
> | 01 | `01-config-and-limits.md` | Protocol constants, byte-limit derivation |
> | 02 | `02-data-models.md` | TypeScript models, action/payload unions |
> | 03 | `03-validation-runtime.md` | Normalizing structural validators |
> | 04 | `04-validation-semantic.md` | Story validation, `validateSessionAgainstStory` |
> | 05 | `05-engine.md` | Pure engine + tests |
> | 06 | `06-example-story.md` | Bundled story + catalog |
> | 07 | `07-transport.md` | `network.ts`, `PeerRoom` additions, transport interface |
> | 08 | `08-sync-authorization.md` | Authorization matrix, sync service, election rounds |
> | 09 | `09-sync-hook-lifecycle.md` | Dispatchers, participation, arbitration, protocol flows |
> | 10 | `10-react-ui-and-room-integration.md` | Context, hook, components, Room mounting |
> | 11 | `11-assets-and-audio.md` | Asset resolution/preload, local audio |
> | 12 | `12-persistence.md` | Checkpoints, latest pointer, tombstone clearing |
> | 13 | `13-testing.md` | Unit/component/E2E matrices, test mesh |
> | 14 | `14-rollout.md` | Regression, manual matrix, rollout, command gate |

## Product outcome

Users who join the same existing Chitchatter room can keep voice and text chat active while reading one synchronized visual novel. A controller peer owns canonical progression; other peers request progression. All live story state travels over the existing peer-to-peer data channel.

## Threat model

Novella state synchronization is **crash-fault tolerant among honest room members**. It is *not* Byzantine fault tolerant in the MVP, and no document in this set may claim otherwise.

What this means concretely:

- Everyone in a Chitchatter room already shares the room secret, can read and write chat, join calls, and impersonate content at the application layer. The novella protocol treats room members as **cooperating but crash-prone**: peers may disconnect, lag, duplicate, reorder, or replay messages, and the protocol must converge despite that.
- The validation and authorization layers exist to stop **accidental and structural** corruption (malformed payloads, stale replays, misrouted sessions, buggy peers) and to stop *casual* interference (a non-controller cannot progress, restart, end, or switch the story through any implemented path).
- A **deliberately malicious room member** can fabricate structurally valid state during the two provenance-blind windows — bootstrap (null local state) and election (departed controller) — because nothing in the MVP cryptographically proves a state was ever controller-authorized. The MVP accepts this residual risk; it is equivalent to the trust users already extend by sharing a room.

**Post-MVP hardening path (documented, not scheduled):** Chitchatter peers already exchange verified public keys (`services/Encryption`, peer verification flow). A hardened protocol adds a controller signature over `digest(state)` to every snapshot-class payload and a signed canonical chain (`prevDigest` per event). Election candidates then carry the last controller-signed digest, and replicas reject unproven state. Nothing in the MVP design forecloses this: all state travels in one validated envelope with room for a `proof` field.

Wherever a rule below exists *because* of the crash-fault model (bootstrap snapshot acceptance, election advertisements), the step document says so explicitly.

## Current repository assessment

| File | Existing behavior (verified) | Novella change |
| --- | --- | --- |
| `src/components/Room/Room.tsx` | Renders both the group room and targeted DM rooms; DM dialogs are `keepMounted` `Room` instances | Mount `VisualNovelProvider` only when `!isDirectMessageRoom`; keep `RoomVideoDisplay` (props: `userId`, `width`, `height`) |
| `src/components/Room/useRoom.ts` | Creates/reuses `PeerRoom`; returns `peerRoom`; reports `isDirectMessageRoom` | Consume the returned `peerRoom` |
| `src/lib/PeerRoom/PeerRoom.ts` | Keyed lifecycle handler maps (one handler per `PeerHookType`); `getPeers()` returns connected remote transport IDs; action tuple `[sender, connectReceiver, progress]` | Add `getSelfId()`, keyed handler removal; satisfies `VisualNovelTransport` structurally |
| `src/hooks/usePeerAction.ts` | Typed sender + one receiver over `PeerRoom.makeAction` | Carry the novella envelope over one action |
| `src/models/network.ts` | Numeric `PeerAction` enum; 12-char action-name limit | Add `VISUAL_NOVEL` only |
| `src/contexts/ShellContext.ts` | Peer list (`Peer.peerId` = transport ID), `peerRoomRef` | Read-only reference; no novella state here |
| `src/contexts/StorageContext.ts` | `getPersistedStorage()` → localforage (`setItem` resolves to the stored value) | Checkpoint adapter (12) |
| `src/services/Encryption` | Peer public keys + signature verification | Unused in MVP; the hook for post-MVP signed digests |

## Non-negotiable invariants

- No central session/state API, message database, account system, analytics, or progress tracking.
- No second Trystero/WebRTC room and no duplicate microphone stream.
- Exactly one novella provider and one replica per browser, bound to the group room. DM rooms never mount novella machinery.
- Story data is declarative JSON. Never `eval`, `new Function`, executable expressions, or raw HTML rendering.
- Every accepted envelope passes, in order: structural validation → **normalization into fresh objects** (no aliasing of untrusted input, no extra properties) → transport identity check → per-action authorization → (for state-carrying payloads) **semantic validation against the loaded story** → application.
- Canonical progression deltas are replayed through the local engine and compared before application.
- Snapshots carry truncated history and byte-bounded variables so a **legal state can never exceed `maxSnapshotBytes`**, including worst-case JSON escaping.
- Duplicate-suppression commits an action ID only after successful application/handling.
- Dispatch is exhaustive; unimplemented actions are rejected and never committed.
- Ended sessions are tombstoned; late events for them are ignored. A participant who left a session stays left until explicit rejoin.
- Chat history and story history are different state domains. Bundled asset bytes never travel in envelopes.

## Module graph

```text
Room.tsx (group room only; DM Room instances skip novella)
  ├─ existing useRoom → existing PeerRoom → Trystero/WebRTC
  ├─ VisualNovelProvider            (exactly one per group room)
  │    ├─ useVisualNovel (composition/state, participation)
  │    │    ├─ useVisualNovelAssets
  │    │    ├─ VisualNovelEngine (pure)
  │    │    └─ useVisualNovelSync → VisualNovelTransport (PeerRoom)
  │    └─ VisualNovelContext
  ├─ VisualNovel UI
  ├─ existing RoomVideoDisplay (userId, width, height — retained)
  ├─ existing ChatTranscript + MessageForm
  └─ existing room audio/video/file controls
```

## Controller model (summary; details in 08/09)

1. Story start enters a bounded **start-arbitration phase**: revision-0 `SESSION_STARTED` candidates are collected with progression disabled, then one wins by the total order `(controllerPeerId, sessionId)`.
2. Participants request; the controller serializes, runs the pure engine, applies locally, and broadcasts canonical events at exactly `revision + 1`. Send failures retry, then repair via snapshot.
3. Replicas authorize per the matrix (08), replay deltas through the engine, and recover gaps with targeted snapshot requests that echo `requestActionId`.
4. Controller transport departure opens an **election round** keyed by the departed controller: peers advertise state to the deterministically computed winner; the winner adopts the highest advertised revision and broadcasts `CONTROLLER_CHANGED` carrying the **full adopted snapshot**, applied atomically. Within the open round, a better announcement (higher revision, then lower peer ID) supersedes an applied one.
5. Only the controller may switch stories or end the session (`SESSION_ENDED`, exact-next revision, tombstoned). A controller leaving the story UI passes control or ends the session; a participant's leave is durable and local.

## File tree

```text
src/
  components/VisualNovel/
    ChoiceList.tsx  DialogueBox.tsx  VisualNovel.tsx  VisualNovelControls.tsx
    VisualNovelLobby.tsx  VisualNovelProvider.tsx  VisualNovelStage.tsx  index.ts
  config/visualNovel.ts
  contexts/VisualNovelContext.tsx
  hooks/
    useVisualNovel.ts  useVisualNovelAssets.ts  useVisualNovelAudio.ts
    useVisualNovelCheckpoint.ts  useVisualNovelSync.ts
  models/visualNovel.ts
  services/visualNovel/
    VisualNovelEngine.ts  VisualNovelSyncService.ts  VisualNovelTransport.ts
    VisualNovelValidator.ts  createVisualNovelEnvelope.ts  index.ts
  stories/
    catalog.ts
    example-story/ (story.json, assets/)
src/**/*.test.ts(x); e2e/tests/visual-novel.test.ts
```

## Delivery milestones

- **M1 — Safe local engine.** Models; normalizing structural validators with aggregate byte limits; semantic story/session validation; pure engine with dead-end semantics; bundled example; local lobby/stage. Exit: the full validator/engine matrices in 13 pass, including normalization, worst-case-encoding, and semantic-mismatch cases.
- **M2 — P2P canonical progression.** One transport action behind `VisualNovelTransport`; exhaustive authorized dispatch; start arbitration; requests + replayed canonical events; send-failure repair; request timeout. Exit: two peers reach identical states through both branches, and every negative case in 13's dispatcher matrix holds.
- **M3 — Recovery, migration, lifecycle.** Solicited bootstrap snapshots; checkpoint + latest pointer; election rounds with atomic state transfer; `SESSION_ENDED` tombstones; participation state; `CONTROL_REQUEST`/`CONTROL_PASSED`.
- **M4 — Production UI.** Story/Video/Chat composition retaining `RoomVideoDisplay`; status surfaces; restart confirmation; local audio controls with autoplay recovery; accessibility.
- **M5 — Hardening.** Multi-context E2E; fuzz/negative suites; regression matrix (14); README/protocol docs; *optional*: signed-digest provenance design from the threat model.

## Definition of done

- Two peers share the same story ID/version/session/revision/scene/dialogue/variables; choices resolve through exactly one controller-approved canonical event verified by engine replay.
- Late join/refresh recovers through solicited, semantically validated snapshots from a completely null state; a participant who left stays left until rejoining.
- Controller departure converges every replica on the same controller **and the same full state** via the election round; announcements outside an open round, from non-winners, or without a valid adopted snapshot are rejected.
- Simultaneous starts converge through the arbitration phase with no split sessions.
- An ended session cannot be resurrected by delayed events; checkpoints for it are cleared.
- Under the stated threat model, no structurally invalid, stale, duplicate, out-of-order, mismatched, oversized, semantically inconsistent, or unimplemented message can mutate state; rejection never poisons duplicate tracking.
- Existing chat, voice, video display, screen share, file transfer, and DM flows regress clean; `npm test -- --run`, `npm run check:types`, `npm run lint`, `npm run build`, and focused E2E pass.

## MVP exclusions

Byzantine-fault provenance (signed digests/chains), graphical authoring, accounts, cloud saves, matchmaking, monetization, AI generation, CRDT multi-writer progression, mandatory custom asset transfer, and large-room optimization.
