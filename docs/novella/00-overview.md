# 00 — Architecture, scope, and delivery plan

> **Revision 3 (2026-07-16).** Second review fixes: controller migration is now a deterministic, revision-aware election handshake (replicas accept only the locally computed winner); every canonical action has an explicit authorization rule with envelope↔payload cross-checks; exactly one novella provider mounts per group room (never in DM rooms); session start/switch/end/leave have authoritative lifecycle semantics including simultaneous-start arbitration and `SESSION_ENDED`; dispatch is exhaustive and unimplemented actions are rejected without commit; validators deep-validate and normalize (history entries, variables, cross-field consistency, non-throwing size checks) and replicas replay canonical deltas through the engine; the sync hook depends on a narrow `VisualNovelTransport` interface with a lifecycle-capable test mesh; checkpoints get a room-scoped latest-session pointer; the room integration keeps `RoomVideoDisplay`.

## Product outcome

Users who join the same existing Chitchatter room can keep voice and text chat active while reading one synchronized visual novel. A controller peer owns canonical progression; other peers request progression. All live story state travels over the existing peer-to-peer data channel.

## Current repository assessment

The `develop` branch already supplies the necessary transport and room lifecycle:

| File | Existing behavior | Novella change |
| --- | --- | --- |
| `src/components/Room/Room.tsx` | Creates **both** the group room and targeted direct-message rooms (`isDirectMessageRoom` from `useRoom`); DM dialogs render additional `keepMounted` `Room` instances | Mount `VisualNovelProvider` **only** when `!isDirectMessageRoom` — one provider per group room (see 04); keep `RoomVideoDisplay` in the layout |
| `src/components/Room/useRoom.ts` | Creates/reuses `PeerRoom`, tracks peers, binds chat actions; already returns `peerRoom` and reports `isDirectMessageRoom` | Consume the returned `peerRoom`; do not merge story state into the chat log |
| `src/lib/PeerRoom/PeerRoom.ts` | Wraps Trystero actions and multiplexes keyed peer lifecycle handlers; `getPeers()` returns currently connected remote transport IDs | Reuse `makeAction`; add keyed removal for novella lifecycle handlers; expose the transport `selfId` via a narrow getter; `PeerRoom` structurally satisfies the new `VisualNovelTransport` interface |
| `src/hooks/usePeerAction.ts` | Creates a typed Trystero sender and connects one receiver; returns `[sender, progress]`; internal action tuple is `[sender, connectReceiver, progress]` | Carry a validated novella envelope over one action |
| `src/models/network.ts` | Defines peer actions; notes a 12-character action-name limit | Add only `VISUAL_NOVEL`; semantic action names remain inside payloads |
| `src/contexts/ShellContext.ts` | Owns peer list, shared `peerRoomRef`, alerts, and chat logs | Read stable peer IDs (`Peer.peerId` is the transport ID); do not put canonical novella state here |
| `src/contexts/RoomContext.ts` | Owns room UI/media/file-transfer state | Leave game state separate; optional view-mode state only |
| `src/contexts/StorageContext.ts` | `getPersistedStorage()` returns a localforage instance (async; `setItem` resolves to the stored value, not `void`) | Wrap behind the checkpoint `StorageAdapter` (see 05) |

## Non-negotiable invariants

- No central session/state API, message database, account system, analytics, or progress tracking.
- No second Trystero/WebRTC room and no duplicate microphone stream.
- Exactly one novella provider and one novella replica per browser, bound to the group room. DM rooms never mount novella machinery.
- Story data is declarative JSON. Never use `eval`, `new Function`, executable expressions, or raw HTML rendering.
- Incoming data is untrusted even though WebRTC is encrypted. Every action type has an explicit authorization rule (03); envelope identifiers must match embedded payload state; accepted states are deeply validated and normalized into fresh objects.
- Canonical progression deltas are replayed through the local engine and compared before application; a mismatch triggers recovery, never blind trust.
- Normal progression uses small canonical events. Snapshots exist for start, late join, reconnect, and recovery, and are only accepted from the authorized sender for their class.
- Snapshots carry a truncated history so a legal state can never exceed the snapshot byte limit (see 01).
- Chat history and story history are different state domains.
- Bundled/static image and audio bytes are not sent inside novella action envelopes.
- Duplicate-suppression records an action ID only after the action is successfully applied or handled, never on receipt.
- Dispatch is exhaustive: an action type without an implemented, authorized handler is rejected and not committed.

## Module graph

```text
Room.tsx (group room only; DM Room instances skip novella)
  ├─ existing useRoom → existing PeerRoom → Trystero/WebRTC
  ├─ VisualNovelProvider            (exactly one per group room)
  │    ├─ useVisualNovel (composition/state)
  │    │    ├─ useVisualNovelAssets
  │    │    ├─ VisualNovelEngine (pure)
  │    │    └─ useVisualNovelSync → usePeerAction → VisualNovelTransport (PeerRoom)
  │    └─ VisualNovelContext
  ├─ VisualNovel UI
  ├─ existing RoomVideoDisplay (video/screen share — retained)
  ├─ existing ChatTranscript + MessageForm
  └─ existing room audio/video/file controls
```

## State ownership

| State | Authority | Storage |
| --- | --- | --- |
| Story catalog/manifests | Application build | Static bundle plus memory cache |
| Canonical session | Current controller peer | Peer memory |
| Session replica | Every participant | Peer memory |
| Seen action IDs | Each sync service | Bounded memory set/map, committed post-apply |
| Election round state | Each sync service, transient | Memory; discarded after migration completes |
| Provisional checkpoint + latest-session pointer | Same browser only | `StorageContext` localforage adapter |
| Chat transcript | Existing shell flow | Existing behavior |
| Voice/media streams | Existing room hooks | Existing behavior |

## Controller model

1. A peer may start a story only from a null local session. It becomes controller, creates `sessionId` at revision `0`, and broadcasts `SESSION_STARTED` (payload controller must equal the sender).
2. **Simultaneous-start arbitration:** if two revision-0 sessions collide, every peer (including both starters) deterministically keeps the session whose `controllerPeerId` is lexicographically smaller and discards the other. The losing starter adopts the winning session.
3. A participant sends a targeted request with its `expectedRevision`. A peer with **no** state sends a bootstrap `STATE_REQUEST` using the reserved bootstrap scope and accepts only a snapshot that echoes its request (`requestActionId`) — or an authorized `SESSION_STARTED`.
4. The controller validates request authorization and current revision; request handling is serialized. The pure engine computes one transition.
5. The controller applies locally, increments revision exactly once, and broadcasts a canonical event. Send failures are retried and then repaired with a snapshot broadcast — canonical state is never silently ahead of the room.
6. Replicas authorize each event per the matrix in 03, replay progression deltas through their own engine, apply revision `n + 1`, ignore duplicates/stale events, and request a snapshot on gaps — targeted at the event's sender when the recorded controller is gone.
7. **Migration handshake** when the controller's transport connection drops: every remaining peer computes the same winner (`electController` over `selfId` + `getPeers()`); non-winners send targeted `ELECTION_ADVERTISE` (revision + truncated state) to the winner; the winner waits a bounded window, adopts the highest advertised revision (`chooseElectionState`), then broadcasts `CONTROLLER_CHANGED`. Replicas accept `CONTROLLER_CHANGED` **only from their locally computed winner**; competing announcements resolve by higher revision, then lower peer ID — a better announcement supersedes an already-applied one.
8. Only the current controller may switch stories (new `SESSION_STARTED` on an existing session) or end the session (`SESSION_ENDED`). A controller leaving the story UI while participants remain must first pass control or end the session; a participant leaving is purely local.

## File tree

```text
src/
  components/VisualNovel/
    ChoiceList.tsx
    DialogueBox.tsx
    VisualNovel.tsx
    VisualNovelControls.tsx
    VisualNovelLobby.tsx
    VisualNovelProvider.tsx
    VisualNovelStage.tsx
    index.ts
  config/visualNovel.ts
  contexts/VisualNovelContext.tsx
  hooks/
    useVisualNovel.ts
    useVisualNovelAssets.ts
    useVisualNovelAudio.ts
    useVisualNovelCheckpoint.ts
    useVisualNovelSync.ts
  models/visualNovel.ts
  services/visualNovel/
    VisualNovelEngine.ts
    VisualNovelSyncService.ts
    VisualNovelTransport.ts      (narrow transport interface)
    VisualNovelValidator.ts
    createVisualNovelEnvelope.ts
    index.ts
  stories/
    catalog.ts
    example-story/
      story.json
      assets/
src/**/*.test.ts(x) for unit tests; e2e/tests/visual-novel.test.ts for E2E
```

## Delivery milestones

### M1 — Safe local engine

- Typed data model (payload interfaces extend `Record<string, any>` for Trystero's `DataPayload`) and **deep** bounded runtime validators: history entries, variable maps, cross-field envelope↔payload consistency, normalization into fresh objects, non-throwing size measurement.
- Pure deterministic engine with explicit dead-end-choice semantics.
- Bundled three-scene example with two endings.
- Local-only lobby and stage.

Exit: engine/validator tests cover valid story, malformed story, advance, both choices, effects, ending, restart, the all-choices-unavailable dead end, malformed history entries, malformed variables, and envelope/payload mismatches.

### M2 — P2P canonical progression

- One `VISUAL_NOVEL` transport action behind the `VisualNovelTransport` interface.
- Exhaustive dispatch with per-action authorization; unimplemented actions rejected without commit.
- `SESSION_STARTED` bootstrap broadcast, simultaneous-start arbitration, controller-only story switch.
- Requests, canonical events with engine replay verification, post-apply duplicate suppression, and revision rules (including `RESTART_REQUEST`).
- Send-failure repair (retry, then snapshot) and request timeout.
- Two peers reach identical states through both branches.

### M3 — Recovery and migration

- Targeted snapshot (history-truncated, request-echoing) on join/reconnect/gap; bootstrap `STATE_REQUEST` for peers with null state; recovery targets the sender when the recorded controller is gone.
- Provisional local checkpoint with latest-session pointer via `StorageContext`.
- Election handshake: `ELECTION_ADVERTISE`, bounded adoption window, winner-only `CONTROLLER_CHANGED`, deterministic supersession of competing announcements.
- `SESSION_ENDED`, `CONTROL_REQUEST`/`CONTROL_PASSED`, and controller-leave rules.

### M4 — Production UI

- Responsive Story/Video/Chat composition that retains `RoomVideoDisplay`.
- Controller/sync status, loading/error states, restart confirmation.
- Local music/SFX controls and browser autoplay recovery.
- Keyboard/screen-reader coverage.

### M5 — Hardening

- Multi-context E2E tests in `e2e/tests/`.
- Oversize/malformed/fuzz-style negative cases, including forged snapshots from non-controllers and self-nominated migration attempts.
- Chat, audio, video, file-transfer, private-room, and direct-message regression checks (including: DM dialogs mount no novella machinery).
- README authoring/protocol/manual-test documentation.

## Definition of done

- Two peers share the same story ID/version/session/revision/scene/dialogue/variables.
- Participant choices resolve through exactly one controller-approved canonical event, and replicas verify the delta by engine replay.
- A late join or refresh catches up through a targeted validated snapshot that echoes the requesting action, including from a completely null local state.
- Controller departure runs the election handshake; the surviving peers converge on one controller with the highest valid known state, and forged or self-nominated announcements are rejected.
- A fabricated snapshot, restart, or session start from a non-controller cannot overwrite any replica.
- Simultaneous story starts converge on one deterministic session.
- Existing text chat, voice, video, and screen-share display remain usable throughout; DM rooms are unaffected.
- Camera access is optional and unrelated to novella mode.
- Invalid, unauthorized, stale, duplicate, out-of-order, mismatched, oversized, and **unimplemented** messages cannot mutate state, and their rejection never poisons the duplicate set against legitimate retransmits.
- A request that receives no response times out and re-enables the UI.
- `npm test -- --run`, `npm run check:types`, `npm run lint`, `npm run build`, and focused E2E pass.

## MVP exclusions

Graphical authoring, accounts, cloud saves, matchmaking, monetization, AI generation, CRDT multi-writer progression, mandatory custom asset transfer, and large-room optimization are intentionally deferred.
