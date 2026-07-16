# 04 — React state, UI components, and room integration

> **Revision 2 changes:** `startStory` now actually broadcasts `SESSION_STARTED` via `sync.startSession`; `restart` is implemented (with confirmation left to the dialog component); `pendingAction` has a timeout so a dropped request cannot permanently disable the UI; `selfPeerId` comes from `peerRoom.getSelfId()` (verified: `useRoom` returns `peerRoom`, and `Peer.peerId` in the shell peer list is the transport ID).

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
  startStory: (storyId: string) => Promise<void>
  advance: () => Promise<void>
  choose: (choiceId: string) => Promise<void>
  restart: () => Promise<void>
  requestControl: () => Promise<void>
  passControl: (peerId: string) => Promise<void>
  leaveStory: () => void
}

export const VisualNovelContext = createContext<VisualNovelContextValue | null>(null)

export const useVisualNovelContext = () => {
  const value = useContext(VisualNovelContext)
  if (!value) throw new Error('VisualNovelProvider is missing')
  return value
}
```

## `src/hooks/useVisualNovel.ts`

This composition hook is the only stateful API the provider needs. `CONTROL_REQUEST`/`CONTROL_PASSED` wiring follows the same request pattern (M3/M4).

```ts
import { useCallback, useMemo, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'

import { visualNovelLimits } from 'config/visualNovel'
import type { PeerRoom } from 'lib/PeerRoom'
import type { VisualNovelSessionState } from 'models/visualNovel'
import { VisualNovelEngine } from 'services/visualNovel'
import { bundledStories, getBundledStory } from 'stories/catalog'
import { useVisualNovelSync } from './useVisualNovelSync'

interface Options {
  peerRoom: PeerRoom
  selfPeerId: string
}

export const useVisualNovel = (options: Options) => {
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
    ...options,
    story,
    state,
    setState: next => {
      setState(next)
      setStatus('ready')
      clearPending() // any canonical update resolves the pending request
    },
    onProtocolError: message => {
      setError(message)
      setStatus('error')
      clearPending()
    },
  })

  const startStory = useCallback(async (storyId: string) => {
    const selected = getBundledStory(storyId)
    if (!selected) throw new Error('Story is unavailable')
    setStatus('loading')
    setError(null)
    try {
      const next = new VisualNovelEngine(selected, { now: Date.now })
        .start(uuid(), options.selfPeerId)
      // Broadcasts SESSION_STARTED and sets local state — peers already in
      // the room bootstrap from this envelope.
      await sync.startSession(next)
      setStatus('ready')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start story')
      setStatus('error')
    }
  }, [options.selfPeerId, sync])

  // A request that never receives a canonical response (controller left,
  // request silently dropped as duplicate/mismatch) must not wedge the UI.
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
    isController: state?.controllerPeerId === options.selfPeerId,
    startStory,
    advance: () => runPending(sync.requestAdvance),
    choose: (choiceId: string) => runPending(() => sync.requestChoice(choiceId)),
    restart: () => runPending(sync.requestRestart), // confirm in dialog first
    requestControl: async () => {}, // M3: CONTROL_REQUEST via same pattern
    passControl: async (_peerId: string) => {}, // M3: CONTROL_PASSED
    leaveStory: () => {
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
import type { PeerRoom } from 'lib/PeerRoom'
import { useVisualNovel } from 'hooks/useVisualNovel'

interface Props extends PropsWithChildren {
  peerRoom: PeerRoom
  selfPeerId: string
}

export const VisualNovelProvider = ({ children, ...options }: Props) => {
  const value = useVisualNovel(options)
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
  const { stories, startStory, pendingAction } = useVisualNovelContext()
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
              <Button disabled={pendingAction} onClick={() => void startStory(story.id)}>
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

`src/components/VisualNovel/DialogueBox.tsx`:

```tsx
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useVisualNovelContext } from 'contexts/VisualNovelContext'

export const DialogueBox = () => {
  const { entry } = useVisualNovelContext()
  if (!entry) return null
  return (
    <Paper aria-live="polite" sx={{ bgcolor: 'rgba(0,0,0,.82)', color: 'white', p: 2 }}>
      {entry.speaker && <Typography fontWeight="bold">{entry.speaker}</Typography>}
      <Typography component="p">{entry.text}</Typography>
    </Paper>
  )
}
```

`src/components/VisualNovel/ChoiceList.tsx`:

```tsx
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import { useVisualNovelContext } from 'contexts/VisualNovelContext'

export const ChoiceList = () => {
  const { availableChoices, choose, pendingAction, isController } = useVisualNovelContext()
  if (!availableChoices.length) return null
  return (
    <Stack aria-label="Story choices" spacing={1}>
      {availableChoices.map(choice => (
        <Button
          key={choice.id}
          variant="contained"
          disabled={pendingAction}
          onClick={() => void choose(choice.id)}
        >
          {choice.label}{isController ? '' : ' (request)'}
        </Button>
      ))}
    </Stack>
  )
}
```

`src/components/VisualNovel/VisualNovelStage.tsx`:

```tsx
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import { useVisualNovelContext } from 'contexts/VisualNovelContext'
import { ChoiceList } from './ChoiceList'
import { DialogueBox } from './DialogueBox'

export const VisualNovelStage = () => {
  const { scene, entry, advance, availableChoices, pendingAction } = useVisualNovelContext()
  if (!scene || !entry) return null
  return (
    <Box sx={{ display: 'grid', gridTemplateRows: '1fr auto', minHeight: 0 }}>
      <Box sx={{ position: 'relative', overflow: 'hidden', bgcolor: 'grey.900' }}>
        {/* Resolve validated asset keys through useVisualNovelAssets. */}
        {(entry.characterChanges ?? scene.characters ?? []).map(character => (
          <Box
            component="img"
            key={character.characterId}
            alt=""
            src={character.sprite}
            sx={{ bottom: 0, height: '90%', objectFit: 'contain', position: 'absolute',
              [character.position]: character.position === 'center' ? '50%' : 0,
              transform: character.position === 'center' ? 'translateX(-50%)' : undefined }}
          />
        ))}
      </Box>
      <Box sx={{ display: 'grid', gap: 1, p: 1 }}>
        <DialogueBox />
        <ChoiceList />
        {!availableChoices.length && (
          <Button disabled={pendingAction} onClick={() => void advance()}>Continue</Button>
        )}
      </Box>
    </Box>
  )
}
```

Use resolved safe asset URLs in production, not raw asset keys as shown by the placeholder `src`.

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

Keep the existing `RoomContext.Provider`, media controls, `ChatTranscript`, `MessageForm`, and `TypingStatusBar`. Replace only the main content arrangement with a responsive view. `useRoom` already returns `peerRoom` (verified), and the transport self ID comes from the new `peerRoom.getSelfId()` getter — **not** from `userId`, which is the Chitchatter identity, not the Trystero peer ID.

```tsx
<RoomContext.Provider value={roomContextValue}>
  <VisualNovelProvider
    peerRoom={peerRoom}
    selfPeerId={peerRoom.getSelfId()}
  >
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Existing room controls stay mounted here. */}
      <Box sx={{
        display: 'grid',
        flex: 1,
        gridTemplateColumns: landscape ? 'minmax(0, 1fr) 400px' : '1fr',
        gridTemplateRows: landscape ? '1fr' : 'minmax(55%, 1fr) minmax(0, 45%)',
        minHeight: 0,
      }}>
        <VisualNovel />
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
  </VisualNovelProvider>
</RoomContext.Provider>
```

Election no longer needs `connectedPeerIds` as a prop — the sync hook reads `peerRoom.getPeers()` at leave time (transport truth; the shell `peerList` updates asynchronously and its ordering relative to the novella leave handler is not guaranteed).

## Accessibility and responsive requirements

- Dialogue changes use a polite live region; controller/error changes use visible status text.
- Choices and continue are native buttons with focus states and pending/disabled feedback.
- Decorative characters have empty alt text; meaningful backgrounds get an accessible stage label.
- Never render story text with `dangerouslySetInnerHTML`.
- On narrow screens use tabs or a view switcher for Story/Chat/Participants, but keep microphone controls persistent.
- Choices must not be obscured by bottom navigation or browser safe-area insets.
- Restart needs a confirmation dialog; story switching warns that it creates a new session (and the sync layer supports it via cross-session snapshots — see 03).
