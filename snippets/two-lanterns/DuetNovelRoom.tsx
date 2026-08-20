import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useContext, useEffect, useMemo, useRef } from 'react'

import { ShellContext } from 'contexts/ShellContext'
import { DUET_ROLES, getDuetRole, isRoleTurn } from 'config/duet'

import type { PeerRoom } from '../../lib/PeerRoom'
import { VisualNovelEngine } from '../../services/visualNovel'
import { getBundledStories, getBundledStory } from '../../stories/catalog'

import { useVisualNovelRoom } from './useVisualNovelRoom'

export interface DuetNovelRoomProps {
  peerRoom: PeerRoom
}

export const DuetNovelRoom = ({ peerRoom }: DuetNovelRoomProps) => {
  const { session, snapshot } = useVisualNovelRoom(peerRoom)
  const { peerList } = useContext(ShellContext)
  const hasAutoStarted = useRef(false)

  const role = getDuetRole() // null if the user skipped character select
  const hasPartner = peerList.length > 0

  const story = snapshot.state
    ? getBundledStory(snapshot.state.storyId, snapshot.state.storyVersion)
    : (getBundledStories()[0] ?? null)

  const engine = useMemo(
    () =>
      story ? new VisualNovelEngine(story, { now: () => Date.now() }) : null,
    [story]
  )

  // ─── Auto-start: only once both lights are on the water ────────────────
  useEffect(() => {
    if (hasAutoStarted.current) return
    if (!story) return
    if (!hasPartner) return // wait for the stranger
    if (snapshot.state) return // story already running
    if (snapshot.phase === 'syncing') return
    if (snapshot.phase === 'ended') return
    if (snapshot.pendingRequest) return
    if (snapshot.error) return

    hasAutoStarted.current = true
    session.startStory(story.id, story.version)
  }, [snapshot, session, story, hasPartner])
  // ────────────────────────────────────────────────────────────────────────

  if (!story || !engine) {
    return (
      <Alert severity="warning" sx={{ m: 1 }}>
        The bundled novella is unavailable.
      </Alert>
    )
  }

  // ─── Waiting for a partner / for the story to begin ────────────────────
  if (!snapshot.state) {
    return (
      <Paper
        component="section"
        aria-label="Novella"
        variant="outlined"
        sx={{ m: 1, p: 2, textAlign: 'center' }}
      >
        {role && (
          <Chip
            label={DUET_ROLES[role].title}
            color="primary"
            size="small"
            sx={{ mb: 1 }}
          />
        )}
        <Typography role="status" variant="body2" color="text.secondary">
          {!hasPartner
            ? 'Watching the water for the other light…'
            : snapshot.phase === 'syncing'
              ? 'The two lights find each other…'
              : 'The story is beginning…'}
        </Typography>
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

  // The lantern: whose turn is it? (No role chosen → always your turn,
  // which degrades gracefully to the original single-driver behavior.)
  const myTurn = role === null || isRoleTurn(role, state.revision)

  const controlsDisabled =
    snapshot.pendingRequest || snapshot.phase === 'syncing' || !myTurn

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
            {role && (
              <Chip
                label={DUET_ROLES[role].title}
                color="primary"
                size="small"
              />
            )}
            <Chip
              label={myTurn ? 'The lantern is yours' : 'Their lantern'}
              color={myTurn ? 'warning' : 'default'}
              variant={myTurn ? 'filled' : 'outlined'}
              size="small"
            />
          </Stack>
        </Stack>

        {snapshot.phase === 'paused' && (
          <Alert severity="warning" role="status">
            <Stack spacing={1} alignItems="flex-start">
              <span>The other light went out. The story is paused.</span>
              {snapshot.canClaimControl && (
                <Button variant="contained" onClick={session.claimControl}>
                  Carry both lanterns
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
          <>
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
                  disabled={snapshot.pendingRequest}
                >
                  Read again
                </Button>
              )}
            </Stack>
            {!myTurn && !isAtEnd && role && (
              <Typography role="status" color="text.secondary" variant="body2">
                {DUET_ROLES[role].turnHint}
              </Typography>
            )}
          </>
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
                disabled={snapshot.pendingRequest}
              >
                Restart story
              </Button>
            </Stack>
          </Alert>
        )}

        {snapshot.pendingRequest && snapshot.phase === 'active' && (
          <Typography role="status" color="text.secondary" variant="body2">
            The light flickers…
          </Typography>
        )}
      </Stack>
    </Paper>
  )
}
