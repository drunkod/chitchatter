// Target: src/pages/NovellaGateway/NovellaGateway.tsx (new file)
//
// The new landing page: step 1 choose your novella, step 2 choose your
// character, then cross into the stage room. Replaces CharacterSelect as
// the root route (see README.md). All four novellas share this component —
// cards and role buttons are generated from the DUETS registry, themed by
// each definition's colors. Pure CSS, no assets.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Typography from '@mui/material/Typography'

import {
  DUETS,
  DuetDefinition,
  DuetRoleDefinition,
  getStageRoomName,
  setDuetSelection,
} from 'config/duets'

// A minimal CSS glyph per novella — a colored "sigil" rather than a full
// scene, so all four render from one component.
const NovellaSigil = ({ duet }: { duet: DuetDefinition }) => {
  const [a, b] = [duet.roles[0].color, duet.roles[1]?.color ?? '#888']

  const glyphByNovella: Record<string, React.ReactNode> = {
    'two-lanterns': (
      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-end' }}>
        <Box
          sx={{
            width: 14,
            height: 44,
            bgcolor: '#2a3444',
            clipPath: 'polygon(20% 0, 80% 0, 100% 100%, 0 100%)',
            boxShadow: `0 -6px 14px 2px ${a}88`,
          }}
        />
        <Box
          sx={{
            width: 44,
            height: 12,
            bgcolor: '#1b2331',
            clipPath: 'polygon(0 0, 100% 0, 80% 100%, 20% 100%)',
            boxShadow: `0 -8px 14px 2px ${b}88`,
          }}
        />
      </Box>
    ),
    masquerade: (
      <Box sx={{ display: 'flex' }}>
        {duet.roles.map(role => (
          <Box
            key={role.id}
            sx={{
              width: 26,
              height: 16,
              ml: '-6px',
              bgcolor: role.color,
              borderRadius: '50% 50% 40% 40%',
              clipPath:
                'polygon(0 0, 100% 0, 100% 60%, 75% 100%, 50% 60%, 25% 100%, 0 60%)',
            }}
          />
        ))}
      </Box>
    ),
    'signal-static': (
      <Box
        sx={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          border: `3px solid ${a}`,
          position: 'relative',
          '&::after': {
            content: '""',
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: 22,
            height: 3,
            bgcolor: b,
            transformOrigin: 'left center',
            transform: 'rotate(-40deg)',
          },
        }}
      />
    ),
    'ink-echo': (
      <Box sx={{ display: 'flex', gap: '3px', alignItems: 'flex-end' }}>
        {[18, 26, 14, 30, 20].map((height, index) => (
          <Box
            key={index}
            sx={{
              width: 8,
              height,
              bgcolor: index % 2 === 0 ? a : b,
              borderRadius: '2px 2px 0 0',
            }}
          />
        ))}
      </Box>
    ),
  }

  return <>{glyphByNovella[duet.id] ?? null}</>
}

export const NovellaGateway = () => {
  const navigate = useNavigate()
  const [duet, setDuet] = useState<DuetDefinition | null>(null)
  const [chosenRole, setChosenRole] = useState<DuetRoleDefinition | null>(null)

  const chooseRole = (role: DuetRoleDefinition) => {
    if (!duet || chosenRole) return

    setChosenRole(role)
    setDuetSelection({ novellaId: duet.id, roleId: role.id })

    // A beat of acknowledgement before the crossing.
    window.setTimeout(() => {
      navigate(`/public/${getStageRoomName(duet.id)}`)
    }, 900)
  }

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        bgcolor: '#0a0c12',
        color: '#cfd8e3',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'auto',
        userSelect: 'none',
        px: 2,
      }}
    >
      <Typography
        sx={{
          letterSpacing: '0.35em',
          textTransform: 'uppercase',
          fontSize: 13,
          opacity: 0.7,
          mb: 1,
        }}
      >
        {duet ? duet.title : 'Duet Novellas'}
      </Typography>
      <Typography
        sx={{ fontSize: 18, mb: 4, opacity: 0.9, textAlign: 'center' }}
      >
        {chosenRole
          ? 'Crossing over…'
          : duet
            ? duet.tagline
            : 'Four small stories for two strangers. Pick yours.'}
      </Typography>

      {/* ── Step 1: choose the novella ─────────────────────────────────── */}
      {!duet && (
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 2,
            justifyContent: 'center',
            maxWidth: 720,
          }}
        >
          {DUETS.map(candidate => (
            <ButtonBase
              key={candidate.id}
              aria-label={`Choose ${candidate.title}`}
              onClick={() => setDuet(candidate)}
              sx={{
                flexDirection: 'column',
                width: 160,
                p: 2.5,
                borderRadius: 2,
                border: '1px solid #232a38',
                transition: 'transform 0.25s, border-color 0.25s',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  borderColor: candidate.roles[0].color,
                },
              }}
            >
              <Box
                sx={{
                  height: 64,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <NovellaSigil duet={candidate} />
              </Box>
              <Typography sx={{ mt: 1.5, fontSize: 15 }}>
                {candidate.title}
              </Typography>
              <Typography
                sx={{ fontSize: 11.5, opacity: 0.55, textAlign: 'center' }}
              >
                {candidate.tagline}
              </Typography>
            </ButtonBase>
          ))}
        </Box>
      )}

      {/* ── Step 2: choose your character ──────────────────────────────── */}
      {duet && (
        <>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 2,
              justifyContent: 'center',
              maxWidth: 720,
            }}
          >
            {duet.roles.map(role => (
              <ButtonBase
                key={role.id}
                aria-label={`Choose ${role.title}`}
                onClick={() => chooseRole(role)}
                disabled={chosenRole !== null}
                sx={{
                  flexDirection: 'column',
                  width: 140,
                  p: 2.5,
                  borderRadius: 2,
                  border: `1px solid ${role.color}55`,
                  opacity: chosenRole && chosenRole.id !== role.id ? 0.15 : 1,
                  transform:
                    chosenRole?.id === role.id ? 'scale(1.06)' : 'none',
                  transition: 'opacity 0.8s, transform 0.8s',
                }}
              >
                <Box
                  sx={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    bgcolor: role.color,
                    boxShadow: `0 0 18px 5px ${role.color}66`,
                  }}
                />
                <Typography sx={{ mt: 1.5, fontSize: 15, color: role.color }}>
                  {role.title}
                </Typography>
              </ButtonBase>
            ))}
          </Box>
          {!chosenRole && (
            <ButtonBase
              onClick={() => setDuet(null)}
              sx={{ mt: 3, px: 2, py: 0.5, borderRadius: 1, opacity: 0.6 }}
            >
              ← Different story
            </ButtonBase>
          )}
        </>
      )}

      <Typography
        sx={{
          mt: 4,
          fontSize: 12,
          opacity: chosenRole ? 0.9 : 0.45,
          transition: 'opacity 0.6s',
          textAlign: 'center',
        }}
      >
        {chosenRole
          ? duet?.waitingText
          : 'A stranger takes the other part. No names. No history. Everything peer-to-peer.'}
      </Typography>
    </Box>
  )
}
