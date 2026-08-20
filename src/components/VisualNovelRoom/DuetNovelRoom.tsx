// Target: src/components/VisualNovelRoom/DuetNovelRoom.tsx (replace)
//
// Generalized for all four novellas. Reads the DuetSelection made on the
// gateway page, looks up the definition in the DUETS registry, and applies
// that novella's turn rule and copy. The P2P layer is untouched: the same
// VisualNovelSession/PeerRoom sync drives every novella; turn gating is
// purely a UI decision about which peer's buttons are live.
//
// Auto-start: role[0] of each novella leads; later roles wait a staggered
// grace period (getAutoStartDelayMs) so exactly one peer starts the story
// even in same-role pairings.

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useContext, useEffect, useMemo, useRef } from 'react'

import { ShellContext } from 'contexts/ShellContext'
import {
  DUETS,
  getAutoStartDelayMs,
  getDuet,
  getDuetSelection,
  isRoleTurn,
} from 'config/duets'

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

  const selection = getDuetSelection() // null if the gateway was skipped
  const duet = selection ? getDuet(selection.novellaId) : DUETS[0]
  const role =
    selection && duet
      ? (duet.roles.find(candidate => candidate.id === selection.roleId) ??
        null)
      : null
  const hasPartner = peerList.length > 0

  // A running story's id wins (late joiners follow the room, even if they
  // picked a different novella on the gateway); otherwise use the selection.
  const story = snapshot.state
    ? getBundledStory(snapshot.state.storyId, snapshot.state.storyVersion)
    : duet
      ? getBundledStory(duet.storyId)
      : (getBundledStories()[0] ?? null)

  const engine = useMemo(
    () =>
      story ? new VisualNovelEngine(story, { now: () => Date.now() }) : null,
    [story]
  )

  // ─── Auto-start: role[0] leads, later roles wait their stagger ─────────
  useEffect(() => {
    if (hasAutoStarted.current) return
    if (!story || !duet) return
    if (!hasPartner) return // wait for the stranger
    if (snapshot.state) return // story already running
    if (snapshot.phase === 'syncing') return
    if (snapshot.phase === 'ended') return
    if (snapshot.error) return

    const delayMs = getAutoStartDelayMs(duet, role?.id ?? null)

    const timer = window.setTimeout(() => {
      if (hasAutoStarted.current || snapshot.pendingRequest) return

      hasAutoStarted.current = true
      session.startStory(story.id, story.version)
    }, delayMs)

    return () => window.clearTimeout(timer)
  }, [snapshot, session, story, hasPartner, duet, role])
  // ────────────────────────────────────────────────────────────────────────

  if (!story || !engine || !duet) {
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
            label={role.title}
            color="primary"
            size="small"
            sx={{ mb: 1 }}
          />
        )}
        <Typography role="status" variant="body2" color="text.secondary">
          {!hasPartner
            ? duet.waitingText
            : snapshot.phase === 'syncing'
              ? 'Finding each other…'
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

  // Whose turn? Depends on the novella's rule. (No role → never locked.)
  const myTurn =
    role === null ||
    isRoleTurn(duet, role.id, state.revision, choices.length > 0)

  const controlsDisabled =
    snapshot.pendingRequest || snapshot.phase === 'syncing' || !myTurn

  const showTurnChip = duet.turnRule !== 'free'

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
            {role && <Chip label={role.title} color="primary" size="small" />}
            {showTurnChip && (
              <Chip
                label={myTurn ? 'Your move' : 'Their move'}
                color={myTurn ? 'warning' : 'default'}
                variant={myTurn ? 'filled' : 'outlined'}
                size="small"
              />
            )}
          </Stack>
        </Stack>

        {snapshot.phase === 'paused' && (
          <Alert severity="warning" role="status">
            <Stack spacing={1} alignItems="flex-start">
              <span>{duet.pausedText}</span>
              {snapshot.canClaimControl && (
                <Button variant="contained" onClick={session.claimControl}>
                  {duet.claimText}
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
            {!myTurn && !isAtEnd && role && role.hint && (
              <Typography role="status" color="text.secondary" variant="body2">
                {role.hint}
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
            Waiting for the other side…
          </Typography>
        )}
      </Stack>
    </Paper>
  )
}
