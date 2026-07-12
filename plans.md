# Novella: collaborative visual-novel implementation plan

## Goal

Add a controller-authoritative, peer-to-peer visual-novel mode to the existing room experience while preserving Chitchatter's audio, text chat, privacy model, and room URLs. The first release uses bundled stories, supports two or more peers, and does not introduce accounts, a central game-state service, or a second WebRTC connection.

## Architecture assessment

This plan is based on the current `develop` branch and the supplied product brief.

### Existing extension points

| Existing file | Current responsibility | Novella integration |
| --- | --- | --- |
| `src/components/Room/Room.tsx` | Composes audio/video controls, chat, and room layout; owns `useRoom` result | Mount the novella panel beside chat and pass the existing `peerRoom`, room ID, user ID, and peer list into a visual-novel hook/provider |
| `src/components/Room/useRoom.ts` | Creates/reuses `PeerRoom`; registers chat, metadata, join, and leave behavior | Keep transport ownership here; expose peer identity/lifecycle data needed by novella without mixing novella state into chat logs |
| `src/contexts/RoomContext.ts` | Room-scoped UI/media/file-transfer state | Add only a novella visibility toggle if room controls need it; keep game state in a separate context |
| `src/contexts/ShellContext.ts` | Peer list, alerts, room identity, chat transcript, shared `peerRoomRef` | Reuse peer IDs and peer list for controller status/election; do not put story state in shell state |
| `src/lib/PeerRoom/PeerRoom.ts` | Wraps Trystero actions, streams, peer join/leave hooks | Reuse `makeAction`; add a novella-specific hook key only if lifecycle subscriptions would otherwise collide |
| `src/hooks/usePeerAction.ts` | Binds a typed sender/receiver to an existing `PeerRoom` action | Carry one validated novella envelope type over a short action identifier |
| `src/models/network.ts` | Defines Trystero peer action names | Add one `VISUAL_NOVEL` enum value. Action names are limited to 12 characters, so individual long VN action names must remain inside the envelope, not become separate Trystero actions |

### Important constraints

- `PeerRoom` is already the room's data and media transport. Novella must reuse it.
- Trystero action names are limited to 12 characters. Use one transport action plus `actionType` in the payload.
- The live canonical state is held by peers in memory. Bundled static story assets are not canonical session state.
- Chat transcript backfill and novella snapshot backfill are separate protocols.
- React rendering, network validation, story parsing, and state transitions remain separate and independently testable.
- Audio/video hooks and streams are untouched. Novella music and effects are local playback triggered by canonical events.

## Proposed architecture

```text
Room.tsx
  -> VisualNovelProvider / useVisualNovel
      -> VisualNovelEngine (pure transitions)
      -> VisualNovelValidator (untrusted JSON and envelopes)
      -> useVisualNovelSync
          -> usePeerAction
              -> existing PeerRoom / Trystero channel
  -> VisualNovel UI
  -> existing ChatTranscript + MessageForm
  -> existing audio/video controls
```

### State ownership

| State | Owner | Persistence |
| --- | --- | --- |
| Parsed story catalog | `useVisualNovelAssets` | Bundled/static assets; cached in memory |
| Canonical session | Controller's `useVisualNovelSync` | Peer memory; optional local checkpoint |
| Replica session | Each non-controller peer | Peer memory, replaced only by a valid newer snapshot/event |
| Seen action IDs | Sync service | Bounded in-memory LRU/set per session |
| UI-only state | `VisualNovelContext`/components | React state only |
| Chat messages | Existing `ShellContext` path | Existing behavior, unchanged |
| Voice streams | Existing room audio hooks | Existing behavior, unchanged |

## Controller and synchronization model

1. The peer starting a story creates a random `sessionId`, revision `0`, and becomes controller.
2. Non-controllers send requests (`ADVANCE_REQUEST`, `CHOICE_REQUEST`, `CONTROL_REQUEST`) directly to the controller.
3. The controller validates the request against the current story and state, applies a pure engine transition, increments `revision`, and broadcasts the canonical event.
4. Replicas accept only a valid next revision. Duplicates are ignored by `actionId`. Gaps trigger `STATE_REQUEST` instead of speculative application.
5. A joining/reconnecting peer sends `STATE_REQUEST`. The controller replies directly with `STATE_SNAPSHOT`.
6. If the controller leaves, remaining peers deterministically elect the lexicographically smallest connected stable peer ID. The winner announces `CONTROLLER_CHANGED` with the highest locally known valid state.
7. Simultaneous election announcements are resolved by `(revision, controllerPeerId)`: higher revision wins; at equal revision, lexicographically smaller controller ID wins.

## Protocol design

Use a single payload envelope on `PeerAction.VISUAL_NOVEL`:

```ts
export const VISUAL_NOVEL_PROTOCOL_VERSION = 1 as const

export type VisualNovelActionType =
  | 'STATE_REQUEST'
  | 'STATE_SNAPSHOT'
  | 'ADVANCE_REQUEST'
  | 'ADVANCED'
  | 'CHOICE_REQUEST'
  | 'CHOICE_RESOLVED'
  | 'STORY_SELECTED'
  | 'SESSION_STARTED'
  | 'CONTROL_REQUEST'
  | 'CONTROLLER_CHANGED'
  | 'RESTART_REQUEST'
  | 'RESTARTED'
  | 'ERROR'

export interface VisualNovelActionEnvelope<T = unknown>
  extends Record<string, unknown> {
  protocol: 'visual-novel'
  protocolVersion: typeof VISUAL_NOVEL_PROTOCOL_VERSION
  actionId: string
  actionType: VisualNovelActionType
  sessionId: string
  storyId: string
  storyVersion: string
  senderPeerId: string
  revision: number
  timestamp: number
  payload: T
}
```

All incoming payloads pass through runtime validation before authorization or state mutation. Set conservative limits, for example: 64 KiB envelope, 256 history entries, 128 variables, 128-character IDs, and 8 KiB dialogue text.

## Story model

Use data-only JSON with stable IDs and no executable expressions. Conditions and effects use a small declarative vocabulary:

```ts
export type VisualNovelValue = string | number | boolean

export type VisualNovelCondition = {
  variable: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  value: VisualNovelValue
}

export type VisualNovelEffect =
  | { type: 'set'; variable: string; value: VisualNovelValue }
  | { type: 'increment'; variable: string; amount: number }
```

Validation must ensure unique scene/dialogue/choice IDs, a valid start scene, valid transitions, safe relative asset URLs, bounded values, and no unknown executable fields.

## File-by-file plan

### Models and configuration

- `src/models/visualNovel.ts`: story, session, history, status, condition/effect, and protocol envelope types.
- `src/models/network.ts`: add one `VISUAL_NOVEL` transport action.
- `src/config/visualNovel.ts`: protocol and payload limits, checkpoint version, supported media types.

### Pure services

- `src/services/visualNovel/VisualNovelValidator.ts`: parse unknown JSON/envelopes into typed values or structured validation errors.
- `src/services/visualNovel/VisualNovelEngine.ts`: create, advance, choose, restart, evaluate conditions, apply effects; no React, DOM, network, time, or random globals.
- `src/services/visualNovel/VisualNovelSyncService.ts`: revision checks, duplicate detection, authorization, controller election, and recovery decisions.
- `src/services/visualNovel/index.ts`: public exports.

### Hooks and context

- `src/hooks/useVisualNovelAssets.ts`: catalog loading, validation, URL resolution, current/next-scene preloading, missing-asset state.
- `src/hooks/useVisualNovelSync.ts`: one `usePeerAction` binding, direct requests/snapshots, canonical broadcast, join recovery, and controller migration.
- `src/hooks/useVisualNovel.ts`: compose engine, assets, sync, local audio, and optional checkpoint behavior.
- `src/contexts/VisualNovelContext.tsx`: a narrow UI-facing state/actions contract.

### UI

- `src/components/VisualNovel/VisualNovel.tsx`: lobby/session/error state switch.
- `src/components/VisualNovel/VisualNovelLobby.tsx`: bundled story selection and start action.
- `src/components/VisualNovel/VisualNovelStage.tsx`: background, character layers, loading/fallback UI.
- `src/components/VisualNovel/DialogueBox.tsx`: speaker and plain React text rendering.
- `src/components/VisualNovel/ChoiceList.tsx`: available choices; non-controller requests are allowed but shown as pending until canonical resolution.
- `src/components/VisualNovel/VisualNovelControls.tsx`: controller badge, sync state, restart confirmation, request/pass control, music/SFX volume.
- `src/components/VisualNovel/index.ts`: exports.
- `src/components/Room/Room.tsx`: responsive split layout; keep chat mounted and audio controls accessible.

### Stories and assets

- `src/stories/catalog.ts`: statically imports bundled manifests.
- `src/stories/example-story/story.json`: at least three scenes, a choice, and two endings.
- `src/stories/example-story/assets/*`: licensed/original background and character assets with attribution where required.

### Tests and docs

- `src/services/visualNovel/VisualNovelEngine.test.ts`
- `src/services/visualNovel/VisualNovelValidator.test.ts`
- `src/services/visualNovel/VisualNovelSyncService.test.ts`
- `src/hooks/useVisualNovelSync.test.tsx`
- `src/components/VisualNovel/VisualNovel.test.tsx`
- `src/components/Room/Room.test.tsx`: audio/chat regression coverage and responsive composition.
- `e2e/visual-novel.spec.ts`: two contexts, late join, refresh, controller leave.
- `README.md`: setup, authoring schema, protocol, limitations, and manual test matrix.

## Phased delivery

### Phase 1: pure vertical slice

- Add story/session types, limits, validator, engine, and one example story.
- Render a local-only story stage inside a room.
- Exit criterion: valid/invalid story tests and both endings pass; chat/audio remain usable.

### Phase 2: canonical P2P progression

- Add the single transport action and validated sync layer.
- Implement start, advance, choice, restart, duplicate/stale/gap handling.
- Exit criterion: two peers remain on identical revisions through both branches.

### Phase 3: recovery and controller migration

- Add targeted snapshots, late join, reconnect/refresh, bounded checkpoints, and deterministic election.
- Exit criterion: a late join catches up and the session continues after controller exit.

### Phase 4: responsive UI and local audio

- Complete desktop/mobile layout, loading/errors, controller status, volume controls, asset preloading, and accessibility.
- Exit criterion: keyboard, screen-reader, and mobile interaction tests pass without covering choices or existing room controls.

### Phase 5: hardening and documentation

- Fuzz/negative validation tests, maximum payload checks, out-of-order simulations, E2E test matrix, README authoring guide.
- Exit criterion: `npm test`, `npm run check:types`, `npm run lint`, `npm run build`, and focused E2E tests pass.

## Acceptance checklist

- [ ] Two peers entering the same existing room can keep P2P audio and chat active while playing.
- [ ] Both peers render the same story ID/version, scene, dialogue entry, variables, and revision.
- [ ] Participant requests produce one controller-approved canonical transition.
- [ ] Invalid, duplicate, stale, unauthorized, mismatched, oversized, and out-of-order actions cannot corrupt state.
- [ ] A late join or refreshed client obtains a targeted snapshot.
- [ ] Controller departure elects a deterministic replacement without restarting.
- [ ] Story files are runtime validated and render no raw HTML or executable code.
- [ ] Camera access is never required for novella mode.
- [ ] Static story assets are not sent through small action messages.
- [ ] Existing room, audio, video, chat, file sharing, and direct-message behavior pass regression tests.

## Explicit non-goals for MVP

- Story editor, accounts, cloud saves, matchmaking, analytics, central session database, AI story generation, real-time story editing, or mandatory P2P asset packages.
- CRDT/multi-writer canonical state. The MVP intentionally uses one controller and request/approval messages.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Concurrent requests | Controller serializes against current revision and emits one canonical next revision |
| React stale closures | Stable callbacks/refs in sync hook; pure service owns transition checks |
| Controller leaves during a transition | Peers retain last applied revision; election chooses deterministic controller and requests newer snapshots if advertised |
| Malicious payload or story | Runtime schemas, bounds, authorization, safe URL policy, text-only React rendering |
| Browser autoplay restrictions | Start music/SFX only after user gesture; expose muted/error state; never affect voice stream |
| Large snapshots | Bound history/variables, omit derived render data, reject oversize envelopes |
| Action-name limit | One short Trystero action; semantic types live inside the envelope |
| Private room leakage | Do not log room password/URL; checkpoints contain only story/session state and are room-scoped |

