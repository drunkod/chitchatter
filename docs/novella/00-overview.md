# 00 — Architecture, scope, and delivery plan

## Product outcome

Users who join the same existing Chitchatter room can keep voice and text chat active while reading one synchronized visual novel. A controller peer owns canonical progression; other peers request progression. All live story state travels over the existing peer-to-peer data channel.

## Current repository assessment

The `develop` branch already supplies the necessary transport and room lifecycle:

| File | Existing behavior | Novella change |
| --- | --- | --- |
| `src/components/Room/Room.tsx` | Creates the room experience and composes media/chat UI | Mount a novella provider and responsive stage; retain existing controls/chat |
| `src/components/Room/useRoom.ts` | Creates/reuses `PeerRoom`, tracks peers, binds chat actions | Expose existing `peerRoom`; do not merge story state into the chat log |
| `src/lib/PeerRoom/PeerRoom.ts` | Wraps Trystero actions and multiplexes peer lifecycle handlers | Reuse `makeAction`; add keyed removal for novella lifecycle handlers |
| `src/hooks/usePeerAction.ts` | Creates a typed Trystero sender and connects one receiver | Carry a validated novella envelope over one action |
| `src/models/network.ts` | Defines peer actions; notes a 12-character action-name limit | Add only `VISUAL_NOVEL`; semantic action names remain inside payloads |
| `src/contexts/ShellContext.ts` | Owns peer list, shared `peerRoomRef`, alerts, and chat logs | Read stable peer IDs; do not put canonical novella state here |
| `src/contexts/RoomContext.ts` | Owns room UI/media/file-transfer state | Leave game state separate; optional view-mode state only |

## Non-negotiable invariants

- No central session/state API, message database, account system, analytics, or progress tracking.
- No second Trystero/WebRTC room and no duplicate microphone stream.
- Story data is declarative JSON. Never use `eval`, `new Function`, executable expressions, or raw HTML rendering.
- Incoming data is untrusted even though WebRTC is encrypted. Validate size, shape, identity, story/session compatibility, authorization, and revision.
- Normal progression uses small canonical events. Snapshots exist for start, late join, reconnect, and recovery.
- Chat history and story history are different state domains.
- Bundled/static image and audio bytes are not sent inside novella action envelopes.

## Module graph

```text
Room.tsx
  ├─ existing useRoom → existing PeerRoom → Trystero/WebRTC
  ├─ VisualNovelProvider
  │    ├─ useVisualNovelAssets
  │    ├─ VisualNovelEngine (pure)
  │    └─ useVisualNovelSync → usePeerAction → same PeerRoom
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
| Seen action IDs | Each sync service | Bounded memory set/map |
| Provisional checkpoint | Same browser only | Optional project storage abstraction |
| Chat transcript | Existing shell flow | Existing behavior |
| Voice/media streams | Existing room hooks | Existing behavior |

## Controller model

1. The peer starting a story becomes controller and creates `sessionId` at revision `0`.
2. A participant sends a targeted request with its `expectedRevision`.
3. The controller validates request authorization and current revision.
4. The pure engine computes one transition.
5. The controller increments revision exactly once and broadcasts a canonical event.
6. Replicas apply revision `n + 1`, ignore duplicates/stale events, and request a snapshot on gaps.
7. When the controller disconnects, remaining peers elect the lexicographically smallest connected transport peer ID.

## File tree

```text
src/
  components/VisualNovel/
    ChoiceList.tsx
    DialogueBox.tsx
    VisualNovel.tsx
    VisualNovelControls.tsx
    VisualNovelLobby.tsx
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
    index.ts
  stories/
    catalog.ts
    example-story/
      story.json
      assets/
tests and e2e follow existing repository locations
```

## Delivery milestones

### M1 — Safe local engine

- Typed data model and bounded runtime validators.
- Pure deterministic engine.
- Bundled three-scene example with two endings.
- Local-only lobby and stage.

Exit: engine/validator tests cover valid story, malformed story, advance, both choices, effects, ending, and restart.

### M2 — P2P canonical progression

- One `VISUAL_NOVEL` transport action.
- Requests, canonical events, duplicate suppression, authorization, and revision rules.
- Two peers reach identical states through both branches.

### M3 — Recovery and migration

- Targeted snapshot on join/reconnect/gap.
- Provisional local checkpoint.
- Deterministic controller migration without restart.

### M4 — Production UI

- Responsive stage/chat layout.
- Controller/sync status, loading/error states, restart confirmation.
- Local music/SFX controls and browser autoplay recovery.
- Keyboard/screen-reader coverage.

### M5 — Hardening

- Multi-context E2E tests.
- Oversize/malformed/fuzz-style negative cases.
- Chat, audio, video, file-transfer, private-room, and direct-message regression checks.
- README authoring/protocol/manual-test documentation.

## Definition of done

- Two peers share the same story ID/version/session/revision/scene/dialogue/variables.
- Participant choices resolve through exactly one controller-approved canonical event.
- A late join or refresh catches up through a targeted validated snapshot.
- Controller departure preserves the highest valid known state.
- Existing text chat and voice remain usable throughout.
- Camera access is optional and unrelated to novella mode.
- Invalid, unauthorized, stale, duplicate, out-of-order, mismatched, and oversized messages cannot mutate state.
- `npm test -- --run`, `npm run check:types`, `npm run lint`, `npm run build`, and focused E2E pass.

## MVP exclusions

Graphical authoring, accounts, cloud saves, matchmaking, monetization, AI generation, CRDT multi-writer progression, mandatory custom asset transfer, and large-room optimization are intentionally deferred.

