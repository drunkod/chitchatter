# Novella: implementation steps and code examples

This guide turns `plans.md` into an incremental implementation. Snippets illustrate the intended API and must be reconciled with nearby repository conventions as each step is implemented.

## 1. Create a feature branch and baseline the repository

The branch for this work is `novella`, based on the repository's default `develop` branch.

Before feature code, record a clean baseline:

```bash
npm install
npm test -- --run
npm run check:types
npm run build
```

Inspect the live extension points before editing:

```bash
sed -n '1,240p' src/components/Room/Room.tsx
sed -n '1,420p' src/components/Room/useRoom.ts
sed -n '1,220p' src/lib/PeerRoom/PeerRoom.ts
sed -n '1,160p' src/hooks/usePeerAction.ts
sed -n '1,120p' src/models/network.ts
```

## 2. Define the typed story and session model

Create `src/models/visualNovel.ts`:

```ts
export type VisualNovelValue = string | number | boolean

export interface VisualNovelCharacterPlacement {
  characterId: string
  sprite: string
  position: 'left' | 'center' | 'right'
  expression?: string
}

export interface VisualNovelCondition {
  variable: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  value: VisualNovelValue
}

export type VisualNovelEffect =
  | { type: 'set'; variable: string; value: VisualNovelValue }
  | { type: 'increment'; variable: string; amount: number }

export interface VisualNovelChoice {
  id: string
  label: string
  nextSceneId: string
  conditions?: VisualNovelCondition[]
  effects?: VisualNovelEffect[]
}

export interface VisualNovelDialogueEntry {
  id: string
  speaker?: string
  text: string
  portrait?: string
  characterChanges?: VisualNovelCharacterPlacement[]
  soundEffect?: string
  next?: { sceneId?: string; dialogueEntryId?: string }
  choices?: VisualNovelChoice[]
}

export interface VisualNovelScene {
  id: string
  background?: string
  music?: string
  characters?: VisualNovelCharacterPlacement[]
  dialogue: VisualNovelDialogueEntry[]
}

export interface VisualNovelManifest {
  id: string
  version: string
  title: string
  description?: string
  startSceneId: string
  assets?: Record<string, string>
  scenes: Record<string, VisualNovelScene>
}

export interface VisualNovelHistoryEntry {
  revision: number
  sceneId: string
  dialogueEntryId: string
  choiceId?: string
}

export interface VisualNovelSessionState extends Record<string, unknown> {
  protocolVersion: 1
  storyId: string
  storyVersion: string
  sessionId: string
  sceneId: string
  dialogueEntryId: string
  variables: Record<string, VisualNovelValue>
  history: VisualNovelHistoryEntry[]
  controllerPeerId: string
  revision: number
  updatedAt: number
}
```

Keep state minimal. Backgrounds, sprites, speaker, and available choices are derived from the validated story plus `sceneId`, `dialogueEntryId`, and `variables`.

## 3. Add protocol types and hard limits

Add `src/config/visualNovel.ts`:

```ts
export const visualNovelLimits = {
  maxEnvelopeBytes: 64 * 1024,
  maxHistoryEntries: 256,
  maxVariables: 128,
  maxIdLength: 128,
  maxTextLength: 8 * 1024,
  maxSeenActionIds: 2048,
} as const

export const visualNovelProtocolVersion = 1 as const
```

Append protocol definitions to `src/models/visualNovel.ts`:

```ts
export type VisualNovelActionType =
  | 'STATE_REQUEST'
  | 'STATE_SNAPSHOT'
  | 'ADVANCE_REQUEST'
  | 'ADVANCED'
  | 'CHOICE_REQUEST'
  | 'CHOICE_RESOLVED'
  | 'SESSION_STARTED'
  | 'CONTROL_REQUEST'
  | 'CONTROLLER_CHANGED'
  | 'RESTART_REQUEST'
  | 'RESTARTED'
  | 'ERROR'

export interface VisualNovelActionEnvelope<T = unknown>
  extends Record<string, unknown> {
  protocol: 'visual-novel'
  protocolVersion: 1
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

export type VisualNovelPayloadByAction = {
  STATE_REQUEST: { knownRevision: number }
  STATE_SNAPSHOT: { state: VisualNovelSessionState }
  ADVANCE_REQUEST: { expectedRevision: number }
  ADVANCED: { sceneId: string; dialogueEntryId: string }
  CHOICE_REQUEST: { choiceId: string; expectedRevision: number }
  CHOICE_RESOLVED: {
    choiceId: string
    sceneId: string
    dialogueEntryId: string
    variables: Record<string, VisualNovelValue>
  }
  SESSION_STARTED: { state: VisualNovelSessionState }
  CONTROL_REQUEST: Record<string, never>
  CONTROLLER_CHANGED: { controllerPeerId: string }
  RESTART_REQUEST: { expectedRevision: number }
  RESTARTED: { state: VisualNovelSessionState }
  ERROR: { code: string; requestActionId?: string }
}
```

## 4. Runtime-validate stories and network messages

Create `src/services/visualNovel/VisualNovelValidator.ts`. A hand-written validator avoids adding a dependency; a schema library is also acceptable if bundle impact is reviewed.

```ts
import { visualNovelLimits, visualNovelProtocolVersion } from 'config/visualNovel'
import type {
  VisualNovelActionEnvelope,
  VisualNovelManifest,
} from 'models/visualNovel'

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isSafeAssetPath = (value: string) => {
  if (value.startsWith('/') || value.includes('..')) return false
  try {
    const url = new URL(value, window.location.origin)
    return url.origin === window.location.origin &&
      ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

export const validateEnvelope = (
  input: unknown
): ValidationResult<VisualNovelActionEnvelope> => {
  if (!isRecord(input)) return { ok: false, errors: ['Envelope must be an object'] }

  const byteLength = new TextEncoder().encode(JSON.stringify(input)).byteLength
  const errors: string[] = []
  if (byteLength > visualNovelLimits.maxEnvelopeBytes) errors.push('Envelope too large')
  if (input.protocol !== 'visual-novel') errors.push('Invalid protocol')
  if (input.protocolVersion !== visualNovelProtocolVersion) {
    errors.push('Unsupported protocol version')
  }
  for (const key of ['actionId', 'actionType', 'sessionId', 'storyId',
    'storyVersion', 'senderPeerId'] as const) {
    if (typeof input[key] !== 'string' || input[key].length === 0 ||
      input[key].length > visualNovelLimits.maxIdLength) {
      errors.push(`Invalid ${key}`)
    }
  }
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0) {
    errors.push('Invalid revision')
  }
  if (!Number.isFinite(input.timestamp)) errors.push('Invalid timestamp')

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: input as VisualNovelActionEnvelope }
}
```

Do not stop at the envelope. Validate `payload` using an exhaustive `switch (actionType)`. Validate snapshots recursively, enforce story ID/version/session matching, and never trust `senderPeerId` alone—compare it with Trystero's `MessageContext.peerId`.

Story validation pseudocode:

```ts
export const validateStory = (input: unknown): ValidationResult<VisualNovelManifest> => {
  // 1. Validate primitive fields and size limits.
  // 2. Ensure Object.keys(scenes) matches every scene.id.
  // 3. Ensure every scene contains non-empty, uniquely identified dialogue.
  // 4. Ensure dialogue and choice IDs are globally or scene-locally unique.
  // 5. Verify startSceneId and every nextSceneId.
  // 6. Verify asset references resolve through a declared safe asset path.
  // 7. Reject unknown effect/operator types and executable-looking fields.
  // 8. Return a new normalized value; do not retain the untrusted object.
}
```

For server-independent tests, inject the application origin into `isSafeAssetPath` rather than accessing `window` directly.

## 5. Build a pure engine

Create `src/services/visualNovel/VisualNovelEngine.ts`:

```ts
import type {
  VisualNovelChoice,
  VisualNovelManifest,
  VisualNovelSessionState,
  VisualNovelValue,
} from 'models/visualNovel'

type EngineDeps = { now: () => number }

export class VisualNovelEngine {
  constructor(
    private readonly story: VisualNovelManifest,
    private readonly deps: EngineDeps
  ) {}

  start(sessionId: string, controllerPeerId: string): VisualNovelSessionState {
    const scene = this.story.scenes[this.story.startSceneId]
    return {
      protocolVersion: 1,
      storyId: this.story.id,
      storyVersion: this.story.version,
      sessionId,
      sceneId: scene.id,
      dialogueEntryId: scene.dialogue[0].id,
      variables: {},
      history: [],
      controllerPeerId,
      revision: 0,
      updatedAt: this.deps.now(),
    }
  }

  advance(state: VisualNovelSessionState): VisualNovelSessionState {
    const scene = this.requireScene(state.sceneId)
    const index = scene.dialogue.findIndex(d => d.id === state.dialogueEntryId)
    const entry = scene.dialogue[index]
    if (entry.choices?.length) throw new Error('A choice must be resolved')

    const explicitScene = entry.next?.sceneId
    const targetScene = explicitScene ? this.requireScene(explicitScene) : scene
    const nextEntry = entry.next?.dialogueEntryId
      ? targetScene.dialogue.find(d => d.id === entry.next?.dialogueEntryId)
      : explicitScene
        ? targetScene.dialogue[0]
        : scene.dialogue[index + 1]

    if (!nextEntry) throw new Error('Story has ended')
    return this.commit(state, targetScene.id, nextEntry.id)
  }

  choose(state: VisualNovelSessionState, choiceId: string): VisualNovelSessionState {
    const entry = this.requireEntry(state.sceneId, state.dialogueEntryId)
    const choice = entry.choices?.find(candidate => candidate.id === choiceId)
    if (!choice || !this.isAvailable(choice, state.variables)) {
      throw new Error('Choice is unavailable')
    }
    const nextScene = this.requireScene(choice.nextSceneId)
    const variables = this.applyEffects(state.variables, choice)
    return this.commit(state, nextScene.id, nextScene.dialogue[0].id, {
      choiceId,
      variables,
    })
  }

  restart(state: VisualNovelSessionState): VisualNovelSessionState {
    const fresh = this.start(state.sessionId, state.controllerPeerId)
    return { ...fresh, revision: state.revision + 1 }
  }

  // requireScene, requireEntry, isAvailable, applyEffects and commit are
  // deterministic helpers. commit appends bounded history and increments once.
}
```

Test with a fake clock. No method should call `Date.now()`, `crypto.randomUUID()`, React state, storage, or a network API directly.

## 6. Add one bundled example story

Create `src/stories/example-story/story.json`:

```json
{
  "id": "harbour-lights",
  "version": "1.0.0",
  "title": "Harbour Lights",
  "description": "Two friends decide how to guide a boat home.",
  "startSceneId": "pier",
  "assets": {
    "pierNight": "stories/example-story/assets/pier-night.webp",
    "beacon": "stories/example-story/assets/beacon.webp",
    "dawn": "stories/example-story/assets/dawn.webp",
    "mara": "stories/example-story/assets/mara.webp",
    "sol": "stories/example-story/assets/sol.webp"
  },
  "scenes": {
    "pier": {
      "id": "pier",
      "background": "pierNight",
      "characters": [
        { "characterId": "mara", "sprite": "mara", "position": "left" },
        { "characterId": "sol", "sprite": "sol", "position": "right" }
      ],
      "dialogue": [
        { "id": "pier-1", "speaker": "Mara", "text": "The beacon is dark." },
        {
          "id": "pier-2",
          "speaker": "Sol",
          "text": "Which signal should we send?",
          "choices": [
            {
              "id": "light-beacon",
              "label": "Light the old beacon",
              "nextSceneId": "beacon-ending",
              "effects": [{ "type": "set", "variable": "usedBeacon", "value": true }]
            },
            {
              "id": "wait-for-dawn",
              "label": "Wait together for dawn",
              "nextSceneId": "dawn-ending",
              "effects": [{ "type": "set", "variable": "usedBeacon", "value": false }]
            }
          ]
        }
      ]
    },
    "beacon-ending": {
      "id": "beacon-ending",
      "background": "beacon",
      "dialogue": [{ "id": "beacon-1", "speaker": "Mara", "text": "The light finds them. We did it." }]
    },
    "dawn-ending": {
      "id": "dawn-ending",
      "background": "dawn",
      "dialogue": [{ "id": "dawn-1", "speaker": "Sol", "text": "Morning draws a safe path across the water." }]
    }
  }
}
```

Create `src/stories/catalog.ts` and validate at module boundary:

```ts
import exampleStory from './example-story/story.json'
import { assertValidStory } from 'services/visualNovel'

export const bundledStories = [assertValidStory(exampleStory)]
```

## 7. Extend the existing peer-action transport

In `src/models/network.ts`, add exactly one enum member:

```ts
// NOTE: Action names are limited to 12 characters, otherwise Trystero breaks.
export enum PeerAction {
  MESSAGE = 0,
  MEDIA_MESSAGE,
  MESSAGE_TRANSCRIPT,
  PEER_METADATA,
  AUDIO_CHANGE,
  VIDEO_CHANGE,
  SCREEN_SHARE,
  FILE_OFFER,
  TYPING_STATUS_CHANGE,
  VISUAL_NOVEL,
}
```

Do not add `VN_STATE_SNAPSHOT`, `VN_CHOICE_RESOLVED`, and similar entries here. `PeerRoom.makeAction` stringifies the enum plus namespace, and the existing 12-character limitation makes long action names unsafe. All semantic message types belong in `envelope.actionType`.

## 8. Implement synchronization decisions as a pure service

Create `src/services/visualNovel/VisualNovelSyncService.ts`:

```ts
export type ApplyDecision =
  | { kind: 'ignore'; reason: 'duplicate' | 'stale' }
  | { kind: 'request-snapshot'; reason: 'revision-gap' | 'session-mismatch' }
  | { kind: 'reject'; reason: string }
  | { kind: 'apply' }

export class VisualNovelSyncService {
  private readonly seen = new Map<string, number>()

  inspect(
    envelope: VisualNovelActionEnvelope,
    state: VisualNovelSessionState | null,
    transportPeerId: string
  ): ApplyDecision {
    if (envelope.senderPeerId !== transportPeerId) {
      return { kind: 'reject', reason: 'Sender identity mismatch' }
    }
    if (this.seen.has(envelope.actionId)) {
      return { kind: 'ignore', reason: 'duplicate' }
    }
    this.remember(envelope.actionId, envelope.timestamp)
    if (!state) return envelope.actionType === 'STATE_SNAPSHOT' ||
      envelope.actionType === 'SESSION_STARTED'
      ? { kind: 'apply' }
      : { kind: 'request-snapshot', reason: 'session-mismatch' }
    if (envelope.sessionId !== state.sessionId) {
      return { kind: 'request-snapshot', reason: 'session-mismatch' }
    }
    if (envelope.revision <= state.revision) {
      return { kind: 'ignore', reason: 'stale' }
    }
    if (envelope.revision > state.revision + 1 &&
      envelope.actionType !== 'STATE_SNAPSHOT') {
      return { kind: 'request-snapshot', reason: 'revision-gap' }
    }
    return { kind: 'apply' }
  }

  electController(peerIds: string[]): string {
    const sorted = [...new Set(peerIds)].sort((a, b) => a.localeCompare(b))
    if (!sorted[0]) throw new Error('Cannot elect without a connected peer')
    return sorted[0]
  }

  private remember(actionId: string, timestamp: number) {
    this.seen.set(actionId, timestamp)
    // Evict oldest entries above visualNovelLimits.maxSeenActionIds.
  }
}
```

Requests are an exception to canonical revision application: the controller may receive multiple requests with the same `expectedRevision`, but each request is authorized and evaluated against current state before one transition is accepted. Model request inspection separately from canonical event inspection to keep this distinction explicit.

## 9. Bind synchronization to `PeerRoom`

Create `src/hooks/useVisualNovelSync.tsx`. The exact peer identity should come from the Trystero message context and existing room peer data—not from user IDs.

```ts
const visualNovelNamespace = `${ActionNamespace.GROUP}vn`

export const useVisualNovelSync = ({
  peerRoom,
  selfPeerId,
  connectedPeerIds,
  story,
  state,
  setState,
}: UseVisualNovelSyncOptions) => {
  const engineRef = useRef(new VisualNovelEngine(story, { now: Date.now }))
  const syncRef = useRef(new VisualNovelSyncService())
  const stateRef = useRef(state)
  stateRef.current = state

  const onReceive = useCallback(async (
    input: unknown,
    context: MessageContext
  ) => {
    const validated = validateEnvelope(input)
    if (!validated.ok) {
      console.warn('Rejected visual-novel action', validated.errors)
      return
    }
    const envelope = validated.value
    if (envelope.senderPeerId !== context.peerId) return

    // Validate payload for envelope.actionType before this switch.
    switch (envelope.actionType) {
      case 'STATE_REQUEST':
        if (stateRef.current?.controllerPeerId !== selfPeerId) return
        await sendEnvelope(makeSnapshot(stateRef.current), {
          target: context.peerId,
        })
        return
      case 'ADVANCE_REQUEST':
        return handleControllerAdvanceRequest(envelope, context.peerId)
      case 'CHOICE_REQUEST':
        return handleControllerChoiceRequest(envelope, context.peerId)
      case 'STATE_SNAPSHOT':
      case 'SESSION_STARTED':
      case 'ADVANCED':
      case 'CHOICE_RESOLVED':
      case 'CONTROLLER_CHANGED':
      case 'RESTARTED':
        return applyCanonicalEnvelope(envelope, context.peerId)
      default:
        return
    }
  }, [selfPeerId, setState])

  const [sendEnvelope] = usePeerAction<VisualNovelActionEnvelope>({
    namespace: visualNovelNamespace,
    peerAction: PeerAction.VISUAL_NOVEL,
    peerRoom,
    onReceive,
  })

  const requestAdvance = useCallback(async () => {
    const current = stateRef.current
    if (!current) return
    if (current.controllerPeerId === selfPeerId) {
      return broadcastControllerAdvance()
    }
    await sendEnvelope(makeAdvanceRequest(current), {
      target: current.controllerPeerId,
    })
  }, [selfPeerId, sendEnvelope])

  return { requestAdvance, requestChoice, requestRestart, requestControl }
}
```

Important integration details:

- `usePeerAction` receivers are installed in an effect; keep `onReceive` stable to avoid unnecessary reconnects.
- Use a `stateRef` for latest state inside asynchronous handlers.
- Direct snapshots and participant requests with `{ target: peerId }`.
- Broadcast only canonical controller events.
- Populate `senderPeerId` from the local transport identity; verify it against `MessageContext.peerId` on receive.
- Do not send private-room passwords, keys, room URLs, chat messages, or asset bytes in envelopes.

## 10. Integrate join, reconnect, and controller leave

The current room hook owns peer join/leave handlers under `PeerHookType.NEW_PEER`. Avoid overwriting those callbacks. Two safe approaches:

1. Add `VISUAL_NOVEL` to `PeerHookType` and let the novella sync hook subscribe independently through the existing handler map.
2. Have `useRoom` expose normalized join/leave events to the novella hook.

The first is smaller:

```ts
export enum PeerHookType {
  NEW_PEER = 'NEW_PEER',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
  SCREEN = 'SCREEN',
  FILE_SHARE = 'FILE_SHARE',
  VISUAL_NOVEL = 'VISUAL_NOVEL',
}
```

Register cleanup-aware handlers in the sync hook:

```ts
useEffect(() => {
  peerRoom.onPeerJoin(PeerHookType.VISUAL_NOVEL, peerId => {
    const current = stateRef.current
    if (!current) return
    if (current.controllerPeerId === selfPeerId) {
      void sendEnvelope(makeSnapshot(current), { target: peerId })
    } else {
      void sendEnvelope(makeStateRequest(current), {
        target: current.controllerPeerId,
      })
    }
  })

  peerRoom.onPeerLeave(PeerHookType.VISUAL_NOVEL, peerId => {
    const current = stateRef.current
    if (!current || peerId !== current.controllerPeerId) return
    const next = syncRef.current.electController([
      selfPeerId,
      ...connectedPeerIds.filter(id => id !== peerId),
    ])
    if (next === selfPeerId) void announceControllerChange(next)
  })

  return () => {
    peerRoom.removePeerJoinHandler?.(PeerHookType.VISUAL_NOVEL)
    peerRoom.removePeerLeaveHandler?.(PeerHookType.VISUAL_NOVEL)
  }
}, [peerRoom, selfPeerId, connectedPeerIds, sendEnvelope])
```

`PeerRoom` currently exposes global `onPeerJoinFlush`/`onPeerLeaveFlush`, which would remove other features' handlers. Add key-specific removal methods rather than calling global flush during component cleanup:

```ts
removePeerJoinHandler = (peerHookType: PeerHookType) => {
  this.peerJoinHandlers.delete(peerHookType)
}

removePeerLeaveHandler = (peerHookType: PeerHookType) => {
  this.peerLeaveHandlers.delete(peerHookType)
}
```

For page refresh, load an optional checkpoint as `status: 'recovering'`, render it cautiously, then request a canonical snapshot. Never broadcast a checkpoint or let it override a newer snapshot.

## 11. Compose hook and UI context

Create `src/contexts/VisualNovelContext.tsx`:

```tsx
export interface VisualNovelContextValue {
  story: VisualNovelManifest | null
  state: VisualNovelSessionState | null
  status: 'lobby' | 'loading' | 'syncing' | 'ready' | 'error'
  error: string | null
  isController: boolean
  availableChoices: VisualNovelChoice[]
  startStory: (storyId: string) => Promise<void>
  advance: () => Promise<void>
  choose: (choiceId: string) => Promise<void>
  restart: () => Promise<void>
  requestControl: () => Promise<void>
}

export const VisualNovelContext = createContext<VisualNovelContextValue | null>(null)
```

Create `src/hooks/useVisualNovel.ts` to compose story selection, engine, sync, assets, local audio, and checkpoint effects. `VisualNovelContext` should expose UI actions; it should not expose raw senders or unvalidated setters.

## 12. Build the visual-novel components

Suggested component contract:

```tsx
export const VisualNovel = () => {
  const novel = useRequiredVisualNovelContext()
  if (novel.status === 'lobby') return <VisualNovelLobby />
  if (novel.status === 'error') return <VisualNovelError message={novel.error} />
  return (
    <VisualNovelStage>
      <CharacterLayer />
      <DialogueBox />
      <ChoiceList />
      <VisualNovelControls />
    </VisualNovelStage>
  )
}
```

Render dialogue as plain React text:

```tsx
<Typography component="p">{entry.text}</Typography>
```

Do not use `dangerouslySetInnerHTML`. Give choices real buttons, visible focus, disabled/pending state, and an accessible label that explains whether the local peer controls the story.

Asset handling example:

```tsx
<Box
  role="img"
  aria-label={story.title}
  sx={{
    backgroundImage: backgroundUrl ? `url(${JSON.stringify(backgroundUrl)})` : 'none',
    backgroundColor: 'grey.900',
    backgroundPosition: 'center',
    backgroundSize: 'cover',
  }}
/>
```

Prefer an `<img>` element with `onError` fallback for character sprites. Resolve all URLs through the validated asset catalog.

## 13. Integrate the responsive room layout

In `src/components/Room/Room.tsx`, keep existing room controls and mount the provider inside the established `RoomContext.Provider`:

```tsx
<RoomContext.Provider value={roomContextValue}>
  <VisualNovelProvider
    peerRoom={peerRoom}
    roomId={roomId}
    userId={userId}
  >
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: landscape ? 'minmax(0, 1fr) 400px' : '1fr',
        gridTemplateRows: landscape ? '1fr' : 'minmax(55%, 1fr) minmax(0, 45%)',
        height: '100%',
        minHeight: 0,
      }}
    >
      <VisualNovel />
      <Box sx={{ minHeight: 0, overflow: 'auto' }}>
        {/* Existing ChatTranscript, MessageForm and TypingStatusBar */}
      </Box>
    </Box>
  </VisualNovelProvider>
</RoomContext.Provider>
```

This snippet is conceptual: retain the current conditional video display and message visibility behavior. A practical MVP can add a room view mode (`chat`, `novella`, `split`) and use tabs on mobile. The microphone controls must remain reachable and must not be remounted during scene transitions.

## 14. Add local music and SFX without touching voice audio

Create a small hook using independent `HTMLAudioElement` instances:

```ts
export const useVisualNovelAudio = () => {
  const musicRef = useRef<HTMLAudioElement | null>(null)
  const [musicVolume, setMusicVolume] = useState(0.6)
  const [effectsVolume, setEffectsVolume] = useState(0.8)

  const playMusic = useCallback(async (url: string | null) => {
    musicRef.current?.pause()
    if (!url) return
    const audio = new Audio(url)
    audio.loop = true
    audio.volume = musicVolume
    musicRef.current = audio
    try { await audio.play() } catch { /* show tap-to-enable state */ }
  }, [musicVolume])

  return { musicVolume, setMusicVolume, effectsVolume, setEffectsVolume, playMusic }
}
```

Do not route these elements through `PeerRoom.addStream`; each client plays the same local asset after applying the canonical transition. Leave microphone volume in existing audio controls.

## 15. Optional room-scoped checkpoint

Use the project's browser-storage abstraction if available. Key by room plus session:

```ts
const checkpointKey = `visual-novel:v1:${hashRoomId(roomId)}:${state.sessionId}`
```

Avoid storing a private room URL/password or raw peer secrets. On load:

1. Validate checkpoint schema.
2. Mark it provisional.
3. Send `STATE_REQUEST`.
4. Replace it with any canonical snapshot at an equal or higher revision.
5. Provide a clear “Reset local novella data” action.

## 16. Unit tests

Create `src/services/visualNovel/VisualNovelEngine.test.ts`:

```ts
describe('VisualNovelEngine', () => {
  const engine = new VisualNovelEngine(exampleStory, { now: () => 1000 })

  it('starts at the declared scene and first dialogue', () => {
    expect(engine.start('session-1', 'peer-a')).toMatchObject({
      sceneId: 'pier',
      dialogueEntryId: 'pier-1',
      revision: 0,
    })
  })

  it.each([
    ['light-beacon', 'beacon-ending', true],
    ['wait-for-dawn', 'dawn-ending', false],
  ])('resolves %s to %s', (choiceId, sceneId, usedBeacon) => {
    const atChoice = engine.advance(engine.start('session-1', 'peer-a'))
    expect(engine.choose(atChoice, choiceId)).toMatchObject({
      sceneId,
      variables: { usedBeacon },
      revision: 2,
    })
  })
})
```

Add validator cases for missing start scene, duplicate IDs, invalid transition, unsafe URL, unsupported operator/effect, unexpected payload action, oversize snapshot, sender mismatch, and unsupported protocol version.

Add sync-service cases:

```ts
it('requests recovery for a revision gap', () => {
  expect(service.inspect(envelope({ revision: 4 }), state({ revision: 2 }), 'peer-a'))
    .toEqual({ kind: 'request-snapshot', reason: 'revision-gap' })
})

it('elects deterministically', () => {
  expect(service.electController(['peer-z', 'peer-b', 'peer-a']))
    .toBe('peer-a')
})
```

## 17. Hook, component, and integration tests

For `useVisualNovelSync`:

- Mock `usePeerAction` or a small in-memory `PeerRoom` adapter.
- Mount controller and participant hooks.
- Assert request targeting and one canonical broadcast.
- Deliver the same action twice and assert one transition.
- Deliver revision `n + 2` and assert a targeted snapshot request.
- Deliver a late-join request and assert a targeted snapshot.
- Simulate controller leave and compare all peers' election result.

For UI:

- Lobby lists validated bundled stories.
- Stage uses correct background and sprites.
- Speaker/dialogue/choices are accessible.
- Pending non-controller request is visible.
- Sync and compatibility errors are visible.
- Restart requires confirmation.
- Existing message input and microphone controls remain operable.

## 18. End-to-end test outline

Create `e2e/visual-novel.spec.ts` with two isolated browser contexts:

```ts
test('two peers follow one canonical branch', async ({ browser }) => {
  const controller = await browser.newContext()
  const participant = await browser.newContext()
  const a = await controller.newPage()
  const b = await participant.newPage()

  await a.goto('/public/novella-e2e')
  await b.goto('/public/novella-e2e')
  await a.getByRole('button', { name: 'Harbour Lights' }).click()
  await a.getByRole('button', { name: 'Start story' }).click()

  await expect(b.getByText('The beacon is dark.')).toBeVisible()
  await b.getByRole('button', { name: 'Continue' }).click()
  await expect(a.getByText('Which signal should we send?')).toBeVisible()
  await b.getByRole('button', { name: 'Light the old beacon' }).click()
  await expect(a.getByText('The light finds them. We did it.')).toBeVisible()
  await expect(b.getByText('The light finds them. We did it.')).toBeVisible()
})
```

Use the repository's actual public-room route discovered during implementation. Add tests for late join, page refresh, controller context close, and chat sent during a story.

## 19. Manual validation matrix

### Two windows

1. Run `npm run dev` or `npm start`.
2. Open one public room and copy its URL.
3. Open the URL in a second window/profile.
4. Enable microphone in both and confirm voice.
5. Exchange text messages.
6. Start the example story in window A.
7. Advance/request choices from both windows; verify identical revision and content.
8. Refresh window B; verify snapshot recovery.
9. Close controller window A; verify B becomes controller without restart.

### Two devices, same network

Repeat with the development host reachable over HTTPS or another secure context. Confirm microphone permission and responsive layout.

### Two devices, different networks

Repeat with TURN configured/enabled. Record direct-versus-relay status, latency, and reconnection behavior. Failure to connect without working TURN can be a network limitation rather than a novella protocol failure.

## 20. Documentation updates

Add a README section covering:

- Starting locally and opening two isolated sessions.
- Starting a novella and sharing the existing room URL.
- Controller/request semantics, revisions, snapshots, late join, and migration.
- Story JSON schema and asset path restrictions.
- Creating and registering a bundled story.
- Local music/SFX autoplay caveats.
- WebRTC tracker, STUN/TURN, ad blocker, and cross-domain limitations.
- Privacy: no central progress service, no accounts, and no analytics.

## 21. Final verification

Run focused tests while iterating, then the full gate:

```bash
npm test -- --run
npm run check:types
npm run lint
npm run build
npm run test:e2e -- e2e/visual-novel.spec.ts
```

Review the final diff for accidental secrets, private room URLs, unlicensed assets, large binaries, raw HTML rendering, new network endpoints, duplicate WebRTC/microphone setup, and unrelated formatting changes.

## Definition of done

- The example story reaches both endings locally and with two peers.
- Every remote action is size-, schema-, identity-, session-, story-, authorization-, and revision-validated.
- Normal progression sends small events; snapshots are targeted for start/recovery/late join.
- Duplicate/stale events are harmless; gaps recover.
- Controller departure preserves the story and yields one deterministic controller.
- Existing audio and text chat work throughout the session.
- Full type, lint, unit, build, and focused E2E checks pass.
- README provides reproducible testing and story-authoring instructions.

