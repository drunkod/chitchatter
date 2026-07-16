# 10 — React state, UI components, and room integration

> **Revision 4 changes:** `RoomVideoDisplay` is rendered with its real props (`userId`, `width`, `height` — verified against `RoomVideoDisplayProps`); participant leave/rejoin flows through the durable `Participation` state (09); the lobby reflects the arbitration phase; everything else carries over from Revision 3 (group-room-only mounting, `canStartStory`, request timeout).

React owns rendering and user intent. It does not decide whether a remote transition is valid; that belongs to validators, the engine, and the sync service.

## `src/contexts/VisualNovelContext.tsx`

```tsx
import { createContext, useContext } from 'react'
import type {
  VisualNovelChoice, VisualNovelDialogueEntry, VisualNovelManifest,
  VisualNovelParticipation, VisualNovelScene, VisualNovelSessionState,
} from 'models/visualNovel'

export type VisualNovelStatus =
  | 'lobby' | 'arbitrating' | 'loading' | 'syncing' | 'ready' | 'waiting' | 'error'

export interface VisualNovelContextValue {
  stories: VisualNovelManifest[]
  story: VisualNovelManifest | null
  state: VisualNovelSessionState | null
  scene: VisualNovelScene | null
  entry: VisualNovelDialogueEntry | null
  availableChoices: VisualNovelChoice[]
  status: VisualNovelStatus
  error: string | null
  isController: boolean
  pendingAction: boolean
  canStartStory: boolean
  participation: VisualNovelParticipation
  startStory: (storyId: string) => Promise<void>
  advance: () => Promise<void>
  choose: (choiceId: string) => Promise<void>
  restart: () => Promise<void>
  endStory: () => Promise<void>            // controller only
  requestControl: () => Promise<void>       // M3
  passControl: (peerId: string) => Promise<void> // M3
  leaveStory: () => void                    // participant: durable local leave
  rejoinStory: () => Promise<void>          // clears 'left', bootstraps
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
import { useCallback, useMemo, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'

import { visualNovelLimits } from 'config/visualNovel'
import type { VisualNovelTransport } from 'services/visualNovel'
import type {
  VisualNovelParticipation, VisualNovelSessionState,
} from 'models/visualNovel'
import { VisualNovelEngine } from 'services/visualNovel'
import { bundledStories, getBundledStory } from 'stories/catalog'
import { useVisualNovelSync } from './useVisualNovelSync'

export const useVisualNovel = ({ transport }: { transport: VisualNovelTransport }) => {
  const selfPeerId = transport.getSelfId()
  const [state, setState] = useState<VisualNovelSessionState | null>(null)
  const [participation, setParticipation] =
    useState<VisualNovelParticipation>({ kind: 'joined' })
  const [status, setStatus] = useState<
    'lobby' | 'arbitrating' | 'loading' | 'syncing' | 'ready' | 'waiting' | 'error'
  >('lobby')
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState(false)
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPending = useCallback(() => {
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
    pendingTimerRef.current = null
    setPendingAction(false)
  }, [])

  const story = useMemo(() => state
    ? getBundledStory(state.storyId, state.storyVersion) : null, [state])
  const engine = useMemo(() => story
    ? new VisualNovelEngine(story, { now: Date.now }) : null, [story])

  const sync = useVisualNovelSync({
    transport,
    story,
    state,
    participation,
    setState: next => {
      setState(next)
      setStatus(next ? 'ready' : 'lobby')
      clearPending() // any canonical update resolves the pending request
    },
    onSessionEnded: _sessionId => {
      // checkpoint + latest pointer cleared inside the checkpoint hook (12)
      setStatus('lobby')
      clearPending()
    },
    onProtocolError: message => {
      setError(message)
      setStatus('error')
      clearPending()
    },
  })
  // sync.phase === 'arbitrating' → status 'arbitrating', progression locked.

  const isController = state?.controllerPeerId === selfPeerId
  const canStartStory =
    (state === null && sync.phase === 'idle' && participation.kind === 'joined') ||
    isController

  const startStory = useCallback(async (storyId: string) => {
    if (!canStartStory) { setError('Only the story controller can switch stories'); return }
    const selected = getBundledStory(storyId)
    if (!selected) throw new Error('Story is unavailable')
    setStatus('loading')
    setError(null)
    try {
      const initial = new VisualNovelEngine(selected, { now: Date.now })
        .start(uuid(), selfPeerId)
      // Enters the start-arbitration phase (09); may resolve by adopting a
      // concurrent competitor's session instead of `initial`.
      setStatus('arbitrating')
      await sync.startSession(initial)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start story')
      setStatus('error')
    }
  }, [canStartStory, selfPeerId, sync])

  // A request that never receives a canonical response must not wedge the UI.
  const runPending = useCallback(async (work: () => Promise<void>) => {
    if (pendingAction || sync.phase === 'arbitrating') return
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
    status: sync.phase === 'arbitrating' ? 'arbitrating' : status,
    error, pendingAction, isController, canStartStory, participation,
    startStory,
    advance: () => runPending(sync.requestAdvance),
    choose: (choiceId: string) => runPending(() => sync.requestChoice(choiceId)),
    restart: () => runPending(sync.requestRestart), // confirm in dialog first
    endStory: async () => { if (isController) await sync.endSession() },
    requestControl: async () => {}, // M3
    passControl: async (_peerId: string) => {}, // M3
    leaveStory: () => {
      // DURABLE participant leave (09): sync ignores this session until rejoin.
      if (isController || !state) return
      setParticipation({ kind: 'left-current-session', sessionId: state.sessionId })
      setState(null)
      setStatus('lobby')
      setError(null)
      clearPending()
    },
    rejoinStory: async () => {
      setParticipation({ kind: 'joined' })
      await sync.rejoinSession() // bootstrap STATE_REQUEST
    },
  }
}
```

## Provider — one per group room

```tsx
import type { PropsWithChildren } from 'react'
import { VisualNovelContext } from 'contexts/VisualNovelContext'
import type { VisualNovelTransport } from 'services/visualNovel'
import { useVisualNovel } from 'hooks/useVisualNovel'

interface Props extends PropsWithChildren {
  transport: VisualNovelTransport
}

export const VisualNovelProvider = ({ children, transport }: Props) => {
  const value = useVisualNovel({ transport })
  return (
    <VisualNovelContext.Provider value={value}>
      {children}
    </VisualNovelContext.Provider>
  )
}
```

## Components

`DialogueBox`, `ChoiceList`, `VisualNovelStage`, and `VisualNovelLobby` carry over from Revision 3 (polite live region; native buttons; empty alt text for sprites; assets resolved via `useVisualNovelAssets`, never raw keys; start buttons gated on `canStartStory`). Additions:

- Lobby shows an "agreeing on a story…" indicator while `status === 'arbitrating'` (start buttons disabled).
- A participant who left sees a "Rejoin story" affordance (`participation.kind === 'left-current-session'`) instead of the story stage — and is **not** pulled back in by incoming events.
- The controller's menu offers "Pass control" (M3) and "End story for everyone" with a confirmation dialog; never a bare local leave.

Top-level component:

```tsx
export const VisualNovel = () => {
  const { status, error, state, participation, rejoinStory } = useVisualNovelContext()
  if (participation.kind === 'left-current-session') {
    return <RejoinNotice onRejoin={() => void rejoinStory()} />
  }
  if (status === 'lobby' || status === 'arbitrating' || !state) return <VisualNovelLobby />
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

**Mount exactly one provider per browser, in the group room only.** `Room` renders both the group room and targeted DM rooms, and each peer-list item keeps a `keepMounted` dialog containing another targeted `Room`. An unconditional wrap would create multiple receivers on the same `gvn` action, duplicate bootstrap requests, divergent replicas, and — because `PeerRoom` stores one handler per `PeerHookType` — providers that overwrite and then delete each other's lifecycle handlers.

`RoomVideoDisplay` requires `userId`, `width`, and `height` (verified: `RoomVideoDisplayProps`); size it explicitly inside the layout:

```tsx
const roomBody = (
  <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
    {/* Existing room controls stay mounted here. */}
    <Box sx={{
      display: 'grid',
      flex: 1,
      gridTemplateColumns: landscape ? 'minmax(0, 1fr) 400px' : '1fr',
      gridTemplateRows: landscape ? '1fr' : 'minmax(55%, 1fr) minmax(0, 45%)',
      minHeight: 0,
    }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Story and media share the main column; video collapses when no
            streams are active (existing showVideoDisplay logic). */}
        {showVideoDisplay && (
          <Box sx={{ flex: '0 0 40%', minHeight: 0 }}>
            <RoomVideoDisplay userId={userId} width="100%" height="100%" />
          </Box>
        )}
        {!isDirectMessageRoom && <VisualNovel />}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <ChatTranscript messageLog={messageLog} userId={userId} />
        <Divider />
        <MessageForm
          onMessageSubmit={handleMessageSubmit}
          isMessageSending={isMessageSending}
          onMessageChange={handleMessageChange}
        />
        {showActiveTypingStatus && (
          <TypingStatusBar isDirectMessageRoom={isDirectMessageRoom} />
        )}
      </Box>
    </Box>
  </Box>
)

return (
  <RoomContext.Provider value={roomContextValue}>
    {isDirectMessageRoom ? (
      roomBody
    ) : (
      <VisualNovelProvider transport={peerRoom}>
        {roomBody}
      </VisualNovelProvider>
    )}
  </RoomContext.Provider>
)
```

`peerRoom` (returned by `useRoom`) satisfies `VisualNovelTransport` structurally. The transport self ID comes from `peerRoom.getSelfId()` — **not** `userId`, which is the Chitchatter identity. Election reads `transport.getPeers()` inside the sync hook; no peer-list prop is threaded through React.

When both video streams and a story are active on narrow screens, use a tabbed main column (Story / Video / Chat view switcher) — design the composition explicitly rather than letting the story push video out of the layout.

## Accessibility and responsive requirements

- Dialogue changes use a polite live region; controller/error/arbitration changes use visible status text.
- Choices and continue are native buttons with focus states and pending/disabled feedback.
- Decorative characters have empty alt text; meaningful backgrounds get an accessible stage label.
- Never render story text with `dangerouslySetInnerHTML`.
- On narrow screens use tabs for Story/Video/Chat/Participants, keeping microphone controls persistent; choices must not be obscured by bottom navigation or safe-area insets.
- Restart and "end story for everyone" need confirmation dialogs; story switching is controller-only and warns that it creates a new session.
