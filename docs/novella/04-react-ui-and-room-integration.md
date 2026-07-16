# 04 — React state, UI components, and room integration

> **Revision 3 changes:** the provider mounts **only in the group room** (`!isDirectMessageRoom`) — the previous unconditional wrap put a novella receiver, replica, bootstrap request, and `PeerHookType.VISUAL_NOVEL` registration inside every `keepMounted` DM dialog, and `PeerRoom` keeps only one handler per hook type, so providers overwrote and deleted each other's handlers. Session lifecycle is authoritative: `startStory` is guarded (null state or controller-only switch), `leaveStory` distinguishes controller from participant, and `endStory` exists. The integration layout retains `RoomVideoDisplay`. The provider takes a `VisualNovelTransport`.

React owns rendering and user intent. It does not decide whether a remote transition is valid; that belongs to validators, the engine, and the sync service.

## `src/contexts/VisualNovelContext.tsx`

```tsx
import { createContext, useContext } from 'react'
import type {
  VisualNovelChoice,
  VisualNovelDialogueEntry,
  VisualNovelManifest,
  VisualNovelScene,
  VisualNovelSessionState,
} from 'models/visualNovel'

export type VisualNovelStatus =
  | 'lobby'
  | 'loading'
  | 'syncing'
  | 'ready'
  | 'waiting'
  | 'error'

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
  canStartStory: boolean // null state, or self is controller (story switch)
  startStory: (storyId: string) => Promise<void>
  advance: () => Promise<void>
  choose: (choiceId: string) => Promise<void>
  restart: () => Promise<void>
  endStory: () => Promise<void> // controller only
  requestControl: () => Promise<void>
  passControl: (peerId: string) => Promise<void>
  leaveStory: () => void // participant-local; controller must pass/end first
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
import type { VisualNovelTransport } from 'services/visualNovel/VisualNovelTransport'
import type { VisualNovelSessionState } from 'models/visualNovel'
import { VisualNovelEngine } from 'services/visualNovel'
import { bundledStories, getBundledStory } from 'stories/catalog'
import { useVisualNovelSync } from './useVisualNovelSync'

interface Options {
  transport: VisualNovelTransport
}

export const useVisualNovel = ({ transport }: Options) => {
  const selfPeerId = transport.getSelfId()
  const [state, setState] = useState<VisualNovelSessionState | null>(null)
  const [status, setStatus] = useState<'lobby' | 'loading' | 'syncing' |
    'ready' | 'waiting' | 'error'>('lobby')
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState(false)
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPending = useCallback(() => {
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
    pendingTimerRef.current = null
    setPendingAction(false)
  }, [])

  const story = useMemo(() => state
    ? getBundledStory(state.storyId, state.storyVersion)
    : null, [state])
  const engine = useMemo(() => story
    ? new VisualNovelEngine(story, { now: Date.now })
    : null, [story])

  const sync = useVisualNovelSync({
    transport,
    story,
    state,
    setState: next => {
      setState(next)
      setStatus(next ? 'ready' : 'lobby') // SESSION_ENDED returns to lobby
      clearPending() // any canonical update resolves the pending request
    },
    onProtocolError: message => {
      setError(message)
      setStatus('error')
      clearPending()
    },
  })

  const isController = state?.controllerPeerId === selfPeerId
  // Lifecycle rule: start from null state, or switch as the controller.
  const canStartStory = state === null || isController

  const startStory = useCallback(async (storyId: string) => {
    if (!canStartStory) {
      setError('Only the story controller can switch stories')
      return
    }
    const selected = getBundledStory(storyId)
    if (!selected) throw new Error('Story is unavailable')
    setStatus('loading')
    setError(null)
    try {
      const next = new VisualNovelEngine(selected, { now: Date.now })
        .start(uuid(), selfPeerId)
      // Broadcasts SESSION_STARTED (revision 0). Simultaneous starts from two
      // peers arbitrate deterministically in the sync layer (03) — this call
      // may be superseded and state may adopt the other session.
      await sync.startSession(next)
      setStatus('ready')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start story')
      setStatus('error')
    }
  }, [canStartStory, selfPeerId, sync])

  // A request that never receives a canonical response must not wedge the UI.
  const runPending = useCallback(async (work: () => Promise<void>) => {
    if (pendingAction) return
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
  }, [clearPending, pendingAction])

  const scene = state && engine ? engine.getScene(state) : null
  const entry = state && engine ? engine.getEntry(state) : null
  const availableChoices = state && engine ? engine.getAvailableChoices(state) : []

  return {
    stories: bundledStories,
    story,
    state,
    scene,
    entry,
    availableChoices,
    status,
    error,
    pendingAction,
    isController,
    canStartStory,
    startStory,
    advance: () => runPending(sync.requestAdvance),
    choose: (choiceId: string) => runPending(() => sync.requestChoice(choiceId)),
    restart: () => runPending(sync.requestRestart), // confirm in dialog first
    endStory: async () => {
      if (!isController) return
      await sync.endSession() // broadcasts SESSION_ENDED, clears state
    },
    requestControl: async () => {}, // M3: CONTROL_REQUEST
    passControl: async (_peerId: string) => {}, // M3: CONTROL_PASSED
    leaveStory: () => {
      // Participant-local only. The UI must not offer this to the controller
      // while participants remain — the controller passes control or ends the
      // session instead (no transport leave occurs, so no election would run).
      if (isController) return
      setState(null)
      setStatus('lobby')
      setError(null)
      clearPending()
    },
  }
}
```

## Provider

Create `src/components/VisualNovel/VisualNovelProvider.tsx`:

```tsx
import type { PropsWithChildren } from 'react'
import { VisualNovelContext } from 'contexts/VisualNovelContext'
import type { VisualNovelTransport } from 'services/visualNovel/VisualNovelTransport'
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

## Lobby

`src/components/VisualNovel/VisualNovelLobby.tsx`:

```tsx
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import { useVisualNovelContext } from 'contexts/VisualNovelContext'

export const VisualNovelLobby = () => {
  const { stories, startStory, pendingAction, canStartStory } =
    useVisualNovelContext()
  return (
    <Box aria-labelledby="novella-lobby-title" sx={{ overflow: 'auto', p: 2 }}>
      <Typography id="novella-lobby-title" variant="h5">Choose a story</Typography>
      <Box sx={{ display: 'grid', gap: 2, mt: 2 }}>
        {stories.map(story => (
          <Card key={`${story.id}@${story.version}`} variant="outlined">
            <CardContent>
              <Typography variant="h6">{story.title}</Typography>
              {story.description && <Typography>{story.description}</Typography>}
            </CardContent>
            <CardActions>
              <Button
                disabled={pendingAction || !canStartStory}
                onClick={() => void startStory(story.id)}
              >
                Start {story.title}
              </Button>
            </CardActions>
          </Card>
        ))}
      </Box>
    </Box>
  )
}
```

## Stage, dialogue, and choices

`DialogueBox.tsx`, `ChoiceList.tsx`, and `VisualNovelStage.tsx` are unchanged from Revision 2 (polite live region; native buttons; empty alt text for decorative sprites; asset keys resolved through `useVisualNovelAssets`, never raw). Story switching in the stage's controls must be gated on `canStartStory` and show the "creates a new session" warning.

## Top-level component

```tsx
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import { useVisualNovelContext } from 'contexts/VisualNovelContext'
import { VisualNovelLobby } from './VisualNovelLobby'
import { VisualNovelStage } from './VisualNovelStage'

export const VisualNovel = () => {
  const { status, error, state } = useVisualNovelContext()
  if (status === 'lobby' || !state) return <VisualNovelLobby />
  if (status === 'loading' || status === 'syncing') return <CircularProgress aria-label="Loading story" />
  return <>
    {error && <Alert severity="error">{error}</Alert>}
    <VisualNovelStage />
  </>
}
```

## Integrate with `Room.tsx`

**Mount exactly one provider per browser, in the group room only.** `Room` renders both the group room and targeted direct-message rooms (`useRoom` reports `isDirectMessageRoom`), and each peer-list item keeps a `keepMounted` dialog containing another targeted `Room`. An unconditional wrap would create multiple receivers on the same `gvn` action, duplicate bootstrap requests, divergent replicas, and — because `PeerRoom` stores one join/leave handler per `PeerHookType` — providers that overwrite and then delete each other's lifecycle handlers.

Keep the existing `RoomContext.Provider`, media controls, `ChatTranscript`, `MessageForm`, `TypingStatusBar`, **and `RoomVideoDisplay`** — the previous revision's layout dropped the video/screen-share display while claiming media stayed functional.

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
        {showVideoDisplay && <RoomVideoDisplay userId={userId} />}
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

`peerRoom` (returned by `useRoom`) satisfies `VisualNovelTransport` structurally. The transport self ID comes from `peerRoom.getSelfId()` — **not** from `userId`, which is the Chitchatter identity, not the Trystero peer ID. Election reads `transport.getPeers()` at leave time inside the sync hook; no peer-list prop is threaded through React.

When both video streams and a story are active, prefer a tabbed or stacked main column on narrow screens (Story / Video / Chat view switcher) — design this composition explicitly rather than letting the story push video out of the layout.

## Accessibility and responsive requirements

- Dialogue changes use a polite live region; controller/error changes use visible status text.
- Choices and continue are native buttons with focus states and pending/disabled feedback.
- Decorative characters have empty alt text; meaningful backgrounds get an accessible stage label.
- Never render story text with `dangerouslySetInnerHTML`.
- On narrow screens use tabs or a view switcher for Story/Video/Chat/Participants, but keep microphone controls persistent.
- Choices must not be obscured by bottom navigation or browser safe-area insets.
- Restart needs a confirmation dialog; story switching is controller-only (`canStartStory`) and warns that it creates a new session.
- The controller's "leave story" affordance is replaced by "pass control" / "end story for everyone" while participants remain.
