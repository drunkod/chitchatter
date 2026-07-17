import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useMemo } from 'react'

import type { PeerRoom } from '../../lib/PeerRoom'
import { VisualNovelEngine } from '../../services/visualNovel'
import { getBundledStories, getBundledStory } from '../../stories/catalog'

import { useVisualNovelRoom } from './useVisualNovelRoom'

export interface VisualNovelRoomProps {
  peerRoom: PeerRoom
}

export const VisualNovelRoom = ({ peerRoom }: VisualNovelRoomProps) => {
  const { session, snapshot } = useVisualNovelRoom(peerRoom)
  const story = snapshot.state
    ? getBundledStory(snapshot.state.storyId, snapshot.state.storyVersion)
    : (getBundledStories()[0] ?? null)
  const engine = useMemo(
    () =>
      story ? new VisualNovelEngine(story, { now: () => Date.now() }) : null,
    [story]
  )

  if (!story || !engine) {
    return (
      <Alert severity="warning" sx={{ m: 1 }}>
        The bundled novella is unavailable.
      </Alert>
    )
  }

  if (!snapshot.state) {
    return (
      <Paper
        component="section"
        aria-label="Novella"
        variant="outlined"
        sx={{ m: 1, p: 2 }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ sm: 'center' }}
        >
          <Box sx={{ flex: 1 }}>
            <Typography variant="overline">Room novella</Typography>
            <Typography variant="h6">{story.title}</Typography>
            <Typography color="text.secondary" variant="body2">
              {snapshot.phase === 'ended'
                ? 'The previous story ended. Start a fresh session whenever the room is ready.'
                : 'The story lives with this room and disappears when everyone leaves.'}
            </Typography>
          </Box>
          <Button
            variant="contained"
            onClick={() => session.startStory(story.id, story.version)}
            disabled={snapshot.pendingRequest}
          >
            Start story
          </Button>
        </Stack>
        {snapshot.phase === 'syncing' && (
          <Typography sx={{ mt: 1 }} role="status" variant="body2">
            Checking for an active room story…
          </Typography>
        )}
        {snapshot.error && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {snapshot.error}
          </Alert>
        )}
      </Paper>
    )
  }

  const state = snapshot.state
  const entry = engine.getEntry(state)
  const choices = engine.getAvailableChoices(state)
  const canAdvance = engine.canAdvance(state)
  const isAtEnd = engine.isAtEnd(state)
  const isDeadEnd = engine.isChoiceDeadEnd(state)
  const controlsDisabled =
    snapshot.pendingRequest || snapshot.phase === 'syncing'

  return (
    <Paper
      component="section"
      aria-label="Novella"
      variant="outlined"
      sx={{ m: 1, p: 2 }}
    >
      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          alignItems={{ sm: 'center' }}
        >
          <Box sx={{ flex: 1 }}>
            <Typography variant="overline">{story.title}</Typography>
            {entry.speaker && (
              <Typography color="primary" variant="subtitle2">
                {entry.speaker}
              </Typography>
            )}
            <Typography>{entry.text}</Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label={`Revision ${state.revision}`} size="small" />
            <Chip
              label={snapshot.isController ? 'Storyteller' : 'Participant'}
              color={snapshot.isController ? 'primary' : 'default'}
              size="small"
            />
          </Stack>
        </Stack>

        {snapshot.phase === 'paused' && (
          <Alert severity="warning" role="status">
            <Stack spacing={1} alignItems="flex-start">
              <span>The storyteller left. The story is paused.</span>
              {snapshot.canClaimControl && (
                <Button variant="contained" onClick={session.claimControl}>
                  Continue the story
                </Button>
              )}
            </Stack>
          </Alert>
        )}

        {snapshot.phase === 'syncing' && (
          <Alert severity="info" role="status">
            Recovering the latest story state…
          </Alert>
        )}

        {snapshot.error && (
          <Alert severity="warning">
            <Stack spacing={1} alignItems="flex-start">
              <span>{snapshot.error}</span>
              {snapshot.phase === 'error' && (
                <Button size="small" onClick={session.retryRecovery}>
                  Retry
                </Button>
              )}
            </Stack>
          </Alert>
        )}

        {snapshot.phase !== 'paused' && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            {choices.map(choice => (
              <Button
                key={choice.id}
                variant="contained"
                onClick={() => session.requestChoice(choice.id)}
                disabled={controlsDisabled}
              >
                {choice.label}
              </Button>
            ))}
            {choices.length === 0 && canAdvance && (
              <Button
                variant="contained"
                onClick={session.requestAdvance}
                disabled={controlsDisabled}
              >
                Continue
              </Button>
            )}
            {isAtEnd && (
              <Button
                variant="contained"
                onClick={session.requestRestart}
                disabled={controlsDisabled}
              >
                Read again
              </Button>
            )}
          </Stack>
        )}

        {isDeadEnd && (
          <Alert severity="error">
            <Stack spacing={1} alignItems="flex-start">
              <span>
                No choices are available here. Restart the story or correct the
                bundled story data.
              </span>
              <Button
                size="small"
                variant="contained"
                onClick={session.requestRestart}
                disabled={controlsDisabled}
              >
                Restart story
              </Button>
            </Stack>
          </Alert>
        )}

        {snapshot.pendingRequest && snapshot.phase === 'active' && (
          <Typography role="status" color="text.secondary" variant="body2">
            Waiting for the storyteller…
          </Typography>
        )}

        {snapshot.isController && (
          <Box>
            <Button
              color="error"
              size="small"
              onClick={session.endSession}
              disabled={controlsDisabled}
            >
              End story for room
            </Button>
          </Box>
        )}
      </Stack>
    </Paper>
  )
}
