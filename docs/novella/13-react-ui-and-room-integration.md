# 13 — React state, UI components, and room integration

> **Revision 5 changes:** persistence is **actually wired** — `useVisualNovel` acquires `StorageContext.getPersistedStorage()`, derives a `roomScope`, instantiates `useVisualNovelCheckpoint`, calls `loadLatest()` on mount, renders provisional state read-only, and calls `clear(sessionId)` on end and stale-session replacement (the Revision 4 hook only left a comment). Story switching uses the dedicated `switchSession` API (09). Leave/rejoin delegates to the sync-owned participation ref (11). Start buttons reflect the start-round phase (09).

React owns rendering and user intent. It does not decide whether a remote transition is valid; that belongs to validators, the engine, and the sync service.

## `src/contexts/VisualNovelContext.tsx`

```tsx
import { createContext, useContext } from 'react'
import type {
  VisualNovelChoice, VisualNovelDialogueEntry, VisualNovelManifest,
  VisualNovelParticipation, VisualNovelScene, VisualNovelSessionState,
} from 'models/visualNovel'

export type VisualNovelStatus =
  | 'lobby' | 'starting' | 'loading' | 'syncing' | 'ready'
  | 'waiting' | 'ending' | 'error'

export interface VisualNovelContextValue {
  stories: VisualNovelManifest[]
  story: VisualNovelManifest | null
  state: VisualNovelSessionState | null
  provisional: VisualNovelSessionState | null // checkpoint preview, read-only
  scene: VisualNovelScene | null
  entry: VisualNovelDialogueEntry | null
  availableChoices: VisualNovelChoice[]
  status: VisualNovelStatus
  error: string | null
  isController: boolean
  pendingAction: boolean
  canStartStory: boolean
  participation: VisualNovelParticipation
  startStory: (storyId: string) => Promise<void>       // fresh start → round (09)
  switchStory: (storyId: string) => Promise<void>      // controller only (09)
  advance: () => Promise<void>
  choose: (choiceId: string) => Promise<void>
  restart: () => Promise<void>
  endStory: () => Promise<void>                         // controller only (11)
  requestControl: () => Promise<void>                   // M3
  passControl: (peerId: string) => Promise<void>        // M3
  leaveStory: () => void                                // participant, durable
  rejoinStory: () => Promise<void>
}

export const VisualNovelContext = createContext<VisualNovelContextValue | null>(null)

export const useVisualNovelContext = () => {
  const value = useContext(VisualNovelContext)
  if (!value) throw new Error('VisualNovelProvider is missing')
  return value
}
```

## `src/hooks/useVisualNovel.ts`

```ts
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { visualNovelLimits } from 'config/visualNovel'
import { StorageContext } from 'contexts/StorageContext'
import type { VisualNovelTransport } from 'services/visualNovel'
import type {
  VisualNovelParticipation, VisualNovelSessionState,
} from 'models/visualNovel'
import { VisualNovelEngine } from 'services/visualNovel'
import { bundledStories, getBundledStory } from 'stories/catalog'
import { useVisualNovelCheckpoint } from './useVisualNovelCheckpoint'
import { useVisualNovelSync } from './useVisualNovelSync'

interface Options {
  transport: VisualNovelTransport
  roomId: string
}

export const useVisualNovel = ({ transport, roomId }: Options) => {
  const selfPeerId = transport.getSelfId()
  const [state, setState] = useState<VisualNovelSessionState | null>(null)
  const [participation, setParticipation] =
    useState<VisualNovelParticipation>({ kind: 'joined' })
  const [status, setStatus] = useState<VisualNovelStatus>('lobby')
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState(false)
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPending = useCallback(() => {
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
    pendingTimerRef.current = null
    setPendingAction(false)
  }, [])

  // ---- persistence wiring (15) — the integration contract, not a comment ----
  const { getPersistedStorage } = useContext(StorageContext)
  const storage = useMemo(() => getPersistedStorage(), [getPersistedStorage])
  // One-way digest of the room identifier; never the raw private room URL.
  const roomScope = useMemo(() => digestRoomId(roomId), [roomId])
  const checkpoint = useVisualNovelCheckpoint({ storage, roomScope, state })

  useEffect(() => {
    // Cold start: provisional read-only continuity until canonical arrives.
    void checkpoint.loadLatest()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const story = useMemo(() => state
    ? getBundledStory(state.storyId, state.storyVersion) : null, [state])
  const engine = useMemo(() => story
    ? new VisualNovelEngine(story, { now: Date.now }) : null, [story])

  const sync = useVisualNovelSync({
    transport,
    story,
    state,
    setState: next => {
      if (next && state && next.sessionId !== state.sessionId) {
        void checkpoint.clear(state.sessionId) // stale-session replacement
      }
      setState(next ? checkpoint.acceptCanonical(next) : null)
      setStatus(next ? 'ready' : 'lobby')
      clearPending()
    },
    onParticipationChange: setParticipation, // mirrors the sync-owned ref (11)
    onSessionEnded: sessionId => {
      void checkpoint.clear(sessionId) // the actual clear call (15)
      setStatus('lobby')
      clearPending()
    },
    onProtocolError: message => {
      setError(message)
      setStatus('error')
      clearPending()
    },
  })

  const isController = state?.controllerPeerId === selfPeerId
  const canStartStory =
    (state === null && sync.phase === 'idle' &&
      participation.kind === 'joined') ||
    (isController && sync.phase !== 'terminating')

  const startStory = useCallback(async (storyId: string) => {
    if (!canStartStory) { setError('Cannot start a story right now'); return }
    setError(null)
    if (state && isController) {
      // Controller story switch — dedicated API (09), never the start round.
      await sync.switchSession(storyId, {
        expectedSessionId: state.sessionId,
        expectedRevision: state.revision,
      })
      return
    }
    setStatus('starting') // start-round proposal in flight; only the
    await sync.startSession(storyId) // coordinator's commit installs (09)
  }, [canStartStory, isController, state, sync])

  const runPending = useCallback(async (work: () => Promise<void>) => {
    if (pendingAction || sync.phase !== 'idle') return
    setPendingAction(true)
    setError(null)
    pendingTimerRef.current = setTimeout(() => {
      pendingTimerRef.current = null
      setPendingAction(false)
      setError('No response from the story controller')
      setStatus('waiting')
    }, visualNovelLimits.requestTimeoutMs)
    try { await work() }
    catch (reason) {
      clearPending()
      setError(reason instanceof Error ? reason.message : 'Story action failed')
    }
  }, [clearPending, pendingAction, sync.phase])

  const scene = state && engine ? engine.getScene(state) : null
  const entry = state && engine ? engine.getEntry(state) : null
  const availableChoices = state && engine ? engine.getAvailableChoices(state) : []

  return {
    stories: bundledStories,
    story, state, scene, entry, availableChoices,
    provisional: checkpoint.provisional, // rendered read-only (15)
    status: sync.phase === 'start-round-pending' ? 'starting'
      : sync.phase === 'terminating' ? 'ending'
      : status,
    error, pendingAction, isController, canStartStory, participation,
    startStory,
    switchStory: startStory, // same guarded entry point; kept for API clarity
    advance: () => runPending(sync.requestAdvance),
    choose: (choiceId: string) => runPending(() => sync.requestChoice(choiceId)),
    restart: () => runPending(sync.requestRestart), // confirm in dialog first
    endStory: async () => { if (isController) await sync.endSession() }, // (11)
    requestControl: async () => {}, // M3
    passControl: async (_peerId: string) => {}, // M3
    leaveStory: () => {
      if (isController || !state) return
      sync.leaveSession() // updates the SYNC REF synchronously (11)
      setState(null)
      setStatus('lobby')
      setError(null)
      clearPending()
    },
    rejoinStory: () => sync.rejoinSession(), // ref updated before send (11)
  }
}
```

`digestRoomId` = SHA-256 (hex, truncated) of the room ID via `crypto.subtle` — the storage key must not leak a private room URL (15).

## Provider — one per group room

```tsx
interface Props extends PropsWithChildren {
  transport: VisualNovelTransport
  roomId: string
}

export const VisualNovelProvider = ({ children, transport, roomId }: Props) => {
  const value = useVisualNovel({ transport, roomId })
  return (
    <VisualNovelContext.Provider value={value}>
      {children}
    </VisualNovelContext.Provider>
  )
}
```

## Components

`DialogueBox`, `ChoiceList`, `VisualNovelStage`, `VisualNovelLobby` carry over (polite live region; native buttons; empty alt text; assets via `useVisualNovelAssets`). Behavior updates:

- Lobby shows "agreeing on a story…" while `status === 'starting'` (start round in flight), and a dimmed read-only stage preview when `provisional` exists and no canonical state does.
- `status === 'ending'` disables all progression and shows "ending the story…" (pending termination, 11).
- A participant who left sees a "Rejoin story" notice; incoming events cannot pull them back (ref-guard, 11).
- The controller's menu offers "Switch story…" (confirmation: "starts a new session for everyone"), "Pass control" (M3), and "End story for everyone" (confirmation) — never a bare local leave.

```tsx
export const VisualNovel = () => {
  const { status, error, state, provisional, participation, rejoinStory } =
    useVisualNovelContext()
  if (participation.kind === 'left-current-session') {
    return <RejoinNotice onRejoin={() => void rejoinStory()} />
  }
  if (!state && provisional) return <ProvisionalStagePreview state={provisional} />
  if (status === 'lobby' || status === 'starting' || !state) return <VisualNovelLobby />
  if (status === 'loading' || status === 'syncing') {
    return <CircularProgress aria-label="Loading story" />
  }
  return <>
    {error && <Alert severity="error">{error}</Alert>}
    <VisualNovelStage />
  </>
}
```

## Integrate with `Room.tsx`

Unchanged from Revision 4 except the provider props: **mount exactly one provider, group room only** (DM `Room` instances and `keepMounted` DM dialogs skip novella entirely — `PeerRoom` keeps one handler per `PeerHookType`); keep `RoomVideoDisplay` with its real props.

```tsx
return (
  <RoomContext.Provider value={roomContextValue}>
    {isDirectMessageRoom ? (
      roomBody
    ) : (
      <VisualNovelProvider transport={peerRoom} roomId={roomId}>
        {roomBody}
      </VisualNovelProvider>
    )}
  </RoomContext.Provider>
)
```

with, inside `roomBody`'s main column:

```tsx
{showVideoDisplay && (
  <Box sx={{ flex: '0 0 40%', minHeight: 0 }}>
    <RoomVideoDisplay userId={userId} width="100%" height="100%" />
  </Box>
)}
{!isDirectMessageRoom && <VisualNovel />}
```

`peerRoom.getSelfId()` supplies the transport self ID — never `userId`. Election reads `transport.getPeers()` inside the sync hook.

## Accessibility and responsive requirements

Carry over from Revision 4 (live regions, native buttons, alt text, no `dangerouslySetInnerHTML`, tabs on narrow screens with persistent microphone controls, safe-area-aware choices), plus: the start-round, pending-termination, and provisional-preview states each have visible status text, and the provisional preview is clearly labeled read-only.
