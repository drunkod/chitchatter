import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Typography from '@mui/material/Typography'
import { keyframes } from '@mui/material/styles'

import {
  DUET_ROLES,
  DuetRole,
  getStageRoomName,
  setDuetRole,
} from 'config/duet'

const beamSweep = keyframes`
  0%   { transform: rotate(-14deg); opacity: 0.25; }
  50%  { transform: rotate(14deg);  opacity: 0.55; }
  100% { transform: rotate(-14deg); opacity: 0.25; }
`

const boatBob = keyframes`
  0%   { transform: translateY(0px) rotate(-1deg); }
  50%  { transform: translateY(6px) rotate(1.5deg); }
  100% { transform: translateY(0px) rotate(-1deg); }
`

const lanternFlicker = keyframes`
  0%, 100% { opacity: 0.9; }
  47%      { opacity: 0.75; }
  52%      { opacity: 1; }
  70%      { opacity: 0.8; }
`

export const CharacterSelect = () => {
  const navigate = useNavigate()
  const [chosen, setChosen] = useState<DuetRole | null>(null)

  const choose = (role: DuetRole) => {
    if (chosen) return

    setChosen(role)
    setDuetRole(role)

    // A beat of acknowledgement before the crossing.
    window.setTimeout(() => {
      navigate(`/public/${getStageRoomName()}`)
    }, 900)
  }

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        bgcolor: '#060a14',
        color: '#cfd8e3',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Stars */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `radial-gradient(1px 1px at 20% 30%, #9fb4c8 50%, transparent 50%),
            radial-gradient(1px 1px at 60% 15%, #9fb4c8 50%, transparent 50%),
            radial-gradient(1.5px 1.5px at 80% 40%, #c9d6e2 50%, transparent 50%),
            radial-gradient(1px 1px at 35% 10%, #9fb4c8 50%, transparent 50%),
            radial-gradient(1px 1px at 90% 20%, #9fb4c8 50%, transparent 50%)`,
          opacity: 0.7,
        }}
      />

      <Typography
        sx={{
          letterSpacing: '0.35em',
          textTransform: 'uppercase',
          fontSize: 13,
          opacity: 0.7,
          mb: 1,
        }}
      >
        Two Lanterns
      </Typography>
      <Typography sx={{ fontSize: 18, mb: 5, opacity: 0.9 }}>
        {chosen
          ? DUET_ROLES[chosen].tagline
          : 'Two lights on a dark harbour. Which one is yours?'}
      </Typography>

      <Box
        sx={{
          display: 'flex',
          gap: { xs: 4, sm: 12 },
          alignItems: 'flex-end',
        }}
      >
        {/* ─── The Keeper: lighthouse ─────────────────────────────── */}
        <ButtonBase
          aria-label="Choose the Keeper"
          onClick={() => choose('keeper')}
          disabled={chosen !== null}
          sx={{
            flexDirection: 'column',
            borderRadius: 2,
            p: 2,
            opacity: chosen && chosen !== 'keeper' ? 0.15 : 1,
            transform: chosen === 'keeper' ? 'scale(1.06)' : 'none',
            transition: 'opacity 0.8s, transform 0.8s',
            '&:hover .beam': { opacity: 0.8 },
          }}
        >
          <Box sx={{ position: 'relative', width: 120, height: 180 }}>
            {/* Beam */}
            <Box
              className="beam"
              sx={{
                position: 'absolute',
                top: 18,
                left: 60,
                width: 220,
                height: 44,
                background:
                  'linear-gradient(90deg, rgba(255,214,130,0.55), transparent)',
                clipPath: 'polygon(0 40%, 100% 0, 100% 100%, 0 60%)',
                transformOrigin: 'left center',
                animation: `${beamSweep} 7s ease-in-out infinite`,
              }}
            />
            {/* Tower */}
            <Box
              sx={{
                position: 'absolute',
                bottom: 0,
                left: 44,
                width: 32,
                height: 130,
                background:
                  'repeating-linear-gradient(180deg, #2a3444 0 26px, #1b2331 26px 52px)',
                clipPath: 'polygon(15% 0, 85% 0, 100% 100%, 0 100%)',
              }}
            />
            {/* Lamp room */}
            <Box
              sx={{
                position: 'absolute',
                top: 14,
                left: 50,
                width: 20,
                height: 16,
                bgcolor: '#ffd682',
                borderRadius: '3px',
                boxShadow: '0 0 24px 8px rgba(255,214,130,0.55)',
                animation: `${lanternFlicker} 4s infinite`,
              }}
            />
          </Box>
          <Typography sx={{ mt: 2, fontSize: 16, color: '#ffd682' }}>
            {DUET_ROLES.keeper.title}
          </Typography>
          <Typography sx={{ fontSize: 12, opacity: 0.6, maxWidth: 180 }}>
            Tend the light. Guide them home.
          </Typography>
        </ButtonBase>

        {/* ─── The Sailor: boat with a lantern ─────────────────────── */}
        <ButtonBase
          aria-label="Choose the Sailor"
          onClick={() => choose('sailor')}
          disabled={chosen !== null}
          sx={{
            flexDirection: 'column',
            borderRadius: 2,
            p: 2,
            opacity: chosen && chosen !== 'sailor' ? 0.15 : 1,
            transform: chosen === 'sailor' ? 'scale(1.06)' : 'none',
            transition: 'opacity 0.8s, transform 0.8s',
          }}
        >
          <Box
            sx={{
              position: 'relative',
              width: 140,
              height: 180,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
            }}
          >
            <Box sx={{ animation: `${boatBob} 5s ease-in-out infinite` }}>
              {/* Mast + lantern */}
              <Box
                sx={{
                  position: 'relative',
                  width: 3,
                  height: 70,
                  bgcolor: '#2a3444',
                  mx: 'auto',
                }}
              >
                <Box
                  sx={{
                    position: 'absolute',
                    top: -4,
                    left: -6,
                    width: 14,
                    height: 14,
                    bgcolor: '#ff9d5c',
                    borderRadius: '50%',
                    boxShadow: '0 0 20px 6px rgba(255,157,92,0.5)',
                    animation: `${lanternFlicker} 3s infinite`,
                  }}
                />
              </Box>
              {/* Hull */}
              <Box
                sx={{
                  width: 110,
                  height: 26,
                  bgcolor: '#1b2331',
                  clipPath: 'polygon(0 0, 100% 0, 82% 100%, 18% 100%)',
                }}
              />
            </Box>
          </Box>
          <Typography sx={{ mt: 2, fontSize: 16, color: '#ff9d5c' }}>
            {DUET_ROLES.sailor.title}
          </Typography>
          <Typography sx={{ fontSize: 12, opacity: 0.6, maxWidth: 180 }}>
            Ride the dark water. Watch for the light.
          </Typography>
        </ButtonBase>
      </Box>

      {/* Water line */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '18vh',
          background:
            'linear-gradient(180deg, rgba(20,32,52,0.9), rgba(8,12,22,1))',
        }}
      />

      <Typography
        sx={{
          position: 'absolute',
          bottom: 24,
          fontSize: 12,
          opacity: chosen ? 0.9 : 0.45,
          transition: 'opacity 0.6s',
          zIndex: 1,
        }}
      >
        {chosen
          ? 'Crossing the water…'
          : 'A stranger will take the other light. No names. No history.'}
      </Typography>
    </Box>
  )
}
