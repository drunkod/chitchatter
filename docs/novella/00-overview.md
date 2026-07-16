# 00 — Architecture, scope, and delivery plan

> **Revision 2 (2026-07-16).** This plan set was reviewed against the live codebase. Protocol-level defects fixed in this revision: controller-migration acceptance, missing-state bootstrap requests, duplicate tracking, snapshot size consistency, Trystero `DataPayload` typing, story switching, election source of truth, request timeouts, restart revision checks, and the test-double API shape. Each doc notes its changes.

## Product outcome

Users who join the same existing Chitchatter room can keep voice and text chat active while reading one synchronized visual novel. A controller peer owns canonical progression; other peers request progression. All live story state travels over the existing peer-to-peer data channel.

## Current repository assessment

The `develop` branch already supplies the necessary transport and room lifecycle:

| File | Existing behavior | Novella change |
| --- | --- | --- |
| `src/components/Room/Room.tsx` | Creates the room experience and composes media/chat UI | Mount a novella provider and responsive stage; retain existing controls/chat |
| `src/components/Room/useRoom.ts` | Creates/reuses `PeerRoom`, tracks peers, binds chat actions; already returns `peerRoom` | Consume the returned `peerRoom`; do not merge story state into the chat log |
| `src/lib/PeerRoom/PeerRoom.ts` | Wraps Trystero actions and multiplexes keyed peer lifecycle handlers | Reuse `makeAction`; add keyed removal for novella lifecycle handlers; expose the transport `selfId` via a narrow getter (verified: nothing in `src/` currently exposes it) |
| `src/hooks/usePeerAction.ts` | Creates a typed Trystero sender and connects one receiver; returns `[sender, progress]`; the internal action tuple is `[sender, connectReceiver, progress]` | Carry a validated novella envelope over one action |
| `src/models/network.ts` | Defines peer actions; notes a 12-character action-name limit | Add only `VISUAL_NOVEL`; semantic action names remain inside payloads |
| `src/contexts/ShellContext.ts` | Owns peer list, shared `peerRoomRef`, alerts, and chat logs | Read stable peer IDs (`Peer.peerId` is the transport ID — verified); do not put canonical novella state here |
| `src/contexts/RoomContext.ts` | Owns room UI/media/file-transfer state | Leave game state separate; optional view-mode state only |
| `src/contexts/StorageContext.ts` | `getPersistedStorage()` returns a localforage instance (async API) | Use as the checkpoint `StorageAdapter` |

## Non-negotiable invariants

- No central session/state API, message database, account system, analytics, or progress tracking.
- No second Trystero/WebRTC room and no duplicate microphone stream.
- Story data is declarative JSON. Never use `eval`, `new Function`, executable expressions, or raw HTML rendering.
- Incoming data is untrusted even though WebRTC is encrypted. Validate size, shape, identity, story/session compatibility, authorization, and revision.
- Normal progression uses small canonical events. Snapshots exist for start, late join, reconnect, and recovery.
- Snapshots carry a truncated history so a legal state can never exceed the snapshot byte limit (see 01).
- Chat history and story history are different state domains.
- Bundled/static image and audio bytes are not sent inside novella action envelopes.
- Duplicate-suppression records an action ID only after the action is successfully applied or handled, never on receipt (see 03).

## Module graph

```text
Room.tsx
  ├─ existing useRoom → existing PeerRoom → Trystero/WebRTC
  ├─ VisualNovelProvider
  │    ├─ useVisualNovel (composition/state)
  │    │    ├─ useVisualNovelAssets
  │    │    ├─ VisualNovelEngine (pure)
  │    │    └─ useVisualNovelSync → usePeerAction → same PeerRoom
  │    └─ VisualNovelContext
  ├─ VisualNovel UI
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
| Provisional checkpoint | Same browser only | `StorageContext` localforage adapter |
| Chat transcript | Existing shell flow | Existing behavior |
| Voice/media streams | Existing room hooks | Existing behavior |

## Controller model

1. The peer starting a story becomes controller and creates `sessionId` at revision `0`, then broadcasts `SESSION_STARTED` so peers already in the room bootstrap immediately.
2. A participant sends a targeted request with its `expectedRevision`. A peer with **no** state sends a bootstrap `STATE_REQUEST` using the reserved bootstrap scope (see 03) — it cannot know real session identifiers yet.
3. The controller validates request authorization and current revision. `STATE_REQUEST` is exempt from session matching so bootstrap works.
4. The pure engine computes one transition.
5. The controller increments revision exactly once and broadcasts a canonical event.
6. Replicas apply revision `n + 1`, ignore duplicates/stale events, and request a snapshot on gaps. Action IDs are committed to the seen-set only after successful application so retransmits of failed messages are not swallowed.
7. When the controller disconnects, remaining peers elect the lexicographically smallest connected transport peer ID, computed from `peerRoom.getPeers()` plus the local `selfId` (transport truth, not React state).
8. Replicas accept `CONTROLLER_CHANGED` from the **new** controller when (a) the sender equals the announced `controllerPeerId`, (b) the previous controller is no longer connected, and (c) the revision is exactly next. Competing announcements resolve by highest revision, then lowest peer ID.

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

- Typed data model (payload interfaces extend `Record<string, any>` to satisfy Trystero's `DataPayload` — matches the repository convention) and bounded runtime validators.
- Pure deterministic engine with explicit dead-end-choice semantics.
- Bundled three-scene example with two endings.
- Local-only lobby and stage.

Exit: engine/validator tests cover valid story, malformed story, advance, both choices, effects, ending, restart, and the all-choices-unavailable dead end.

### M2 — P2P canonical progression

- One `VISUAL_NOVEL` transport action.
- `SESSION_STARTED` bootstrap broadcast wired into story start.
- Requests, canonical events, post-apply duplicate suppression, authorization, and revision rules (including `RESTART_REQUEST` revision check).
- Request timeout so a dropped request cannot wedge the UI.
- Two peers reach identical states through both branches.

### M3 — Recovery and migration

- Targeted snapshot (history-truncated) on join/reconnect/gap; bootstrap `STATE_REQUEST` for peers with null state.
- Provisional local checkpoint via `StorageContext`.
- Deterministic controller migration without restart, with the new-controller acceptance rule above.
- Story switching via cross-session `SESSION_STARTED` snapshots.

### M4 — Production UI

- Responsive stage/chat layout.
- Controller/sync status, loading/error states, restart confirmation.
- Local music/SFX controls and browser autoplay recovery.
- Keyboard/screen-reader coverage.

### M5 — Hardening

- Multi-context E2E tests in `e2e/tests/`.
- Oversize/malformed/fuzz-style negative cases.
- Chat, audio, video, file-transfer, private-room, and direct-message regression checks.
- README authoring/protocol/manual-test documentation.

## Definition of done

- Two peers share the same story ID/version/session/revision/scene/dialogue/variables.
- Participant choices resolve through exactly one controller-approved canonical event.
- A late join or refresh catches up through a targeted validated snapshot, including from a completely null local state.
- Controller departure preserves the highest valid known state and replicas actually apply the migration event.
- Existing text chat and voice remain usable throughout.
- Camera access is optional and unrelated to novella mode.
- Invalid, unauthorized, stale, duplicate, out-of-order, mismatched, and oversized messages cannot mutate state — and their rejection never poisons the duplicate set against legitimate retransmits.
- A request that receives no response times out and re-enables the UI.
- `npm test -- --run`, `npm run check:types`, `npm run lint`, `npm run build`, and focused E2E pass.

## MVP exclusions

Graphical authoring, accounts, cloud saves, matchmaking, monetization, AI generation, CRDT multi-writer progression, mandatory custom asset transfer, and large-room optimization are intentionally deferred.
