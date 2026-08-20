// Target: src/config/duets.ts (new file — generalizes and replaces duet.ts)
//
// One registry for all four duet novellas. Everything else (P2P pairing via
// time-bucketed public rooms, VisualNovelSession sync, turn gating) is
// shared machinery — a new novella is just a registry entry + a story.json.
//
// Turn rules:
//   'alternate' — the turn passes on every story revision (Two Lanterns,
//                 Signal/Static: transmissions go back and forth)
//   'free'      — no gating; any character can act (Masquerade: the ball
//                 is chaos, masks act when they dare)
//   'act-tone'  — asymmetric: beats WITH choices belong to role[0] (Ink,
//                 who decides what happens); beats without choices belong
//                 to role[1] (Echo, who lets it land)

export type TurnRule = 'alternate' | 'free' | 'act-tone'

export interface DuetRoleDefinition {
  id: string
  title: string
  hint: string // shown when it's NOT your turn
  color: string // accent used on the gateway page
}

export interface DuetDefinition {
  id: string
  title: string
  tagline: string
  storyId: string
  turnRule: TurnRule
  waitingText: string
  pausedText: string
  claimText: string
  roles: DuetRoleDefinition[]
}

export const DUETS: DuetDefinition[] = [
  {
    id: 'two-lanterns',
    title: 'Two Lanterns',
    tagline: 'Two lights on a dark harbour. Which one is yours?',
    storyId: 'harbour-lights',
    turnRule: 'alternate',
    waitingText: 'Watching the water for the other light…',
    pausedText: 'The other light went out. The story is paused.',
    claimText: 'Carry both lanterns',
    roles: [
      {
        id: 'keeper',
        title: 'The Keeper',
        hint: 'The lantern is with the Sailor…',
        color: '#ffd682',
      },
      {
        id: 'sailor',
        title: 'The Sailor',
        hint: 'The lantern is with the Keeper…',
        color: '#ff9d5c',
      },
    ],
  },
  {
    id: 'masquerade',
    title: 'Masquerade',
    tagline: 'The candles are low. Choose your mask.',
    storyId: 'the-unmasking-hour',
    turnRule: 'free',
    waitingText: 'Listening for footsteps on the ballroom floor…',
    pausedText: 'Your partner slipped away into the crowd.',
    claimText: 'Dance alone',
    roles: [
      { id: 'fox', title: 'The Fox', hint: '', color: '#e07a3f' },
      { id: 'owl', title: 'The Owl', hint: '', color: '#b8a684' },
      { id: 'cat', title: 'The Cat', hint: '', color: '#8f86b3' },
      { id: 'raven', title: 'The Raven', hint: '', color: '#5d6b7a' },
    ],
  },
  {
    id: 'signal-static',
    title: 'Signal / Static',
    tagline: 'A dead frequency, 3 a.m. Someone is out there.',
    storyId: 'frequency-4-16',
    turnRule: 'alternate',
    waitingText: 'Sweeping the band for another operator…',
    pausedText: 'The other station went dark. Static holds the line.',
    claimText: 'Keep the frequency open',
    roles: [
      {
        id: 'cold-river',
        title: 'COLD RIVER',
        hint: 'LAST ORCHARD is keying a transmission…',
        color: '#7fd1c9',
      },
      {
        id: 'last-orchard',
        title: 'LAST ORCHARD',
        hint: 'COLD RIVER is keying a transmission…',
        color: '#c9d17f',
      },
    ],
  },
  {
    id: 'ink-echo',
    title: 'Ink & Echo',
    tagline: 'One writes what happens. One lets it land.',
    storyId: 'the-unfinished-page',
    turnRule: 'act-tone',
    waitingText: 'Waiting for the other hand at the typewriter…',
    pausedText: 'The other chair is empty. The page waits.',
    claimText: 'Write on alone',
    roles: [
      {
        id: 'ink',
        title: 'Ink',
        hint: 'Echo is letting the last line settle…',
        color: '#4a4a52',
      },
      {
        id: 'echo',
        title: 'Echo',
        hint: 'Ink is deciding what happens next…',
        color: '#a3b2c2',
      },
    ],
  },
]

export const getDuet = (novellaId: string): DuetDefinition | null =>
  DUETS.find(duet => duet.id === novellaId) ?? null

// ─── Duet mode flag with explicit opt-in for E2E duet tests ──────────────
const isE2ETest =
  import.meta.env.VITE_IS_E2E_TEST === 'true' ||
  import.meta.env.VITE_IS_E2E_TEST === '1'

const duetFlag = import.meta.env.VITE_DUET_MODE

export const isDuetMode: boolean =
  duetFlag === 'true' || duetFlag === '1'
    ? true // explicit opt-in wins, even in E2E tests
    : !isE2ETest && duetFlag !== 'false'

// ─── Selection persistence (per-tab, anonymous) ──────────────────────────
export interface DuetSelection {
  novellaId: string
  roleId: string
}

const STORAGE_KEY = 'novella-duet-selection'

export const setDuetSelection = (selection: DuetSelection) => {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
}

export const getDuetSelection = (): DuetSelection | null => {
  const raw = window.sessionStorage.getItem(STORAGE_KEY)

  if (raw === null) return null

  try {
    const parsed = JSON.parse(raw)
    const duet = getDuet(parsed.novellaId)

    if (duet && duet.roles.some(role => role.id === parsed.roleId)) {
      return { novellaId: parsed.novellaId, roleId: parsed.roleId }
    }
  } catch {
    // Corrupt value; treat as no selection.
  }

  return null
}

// ─── Anonymous pairing (unchanged mechanism, per-novella rooms) ──────────
// Strangers who picked the SAME novella within the same 10-minute window
// land in the same public chitchatter room. All existing P2P machinery
// (trackers, WebRTC, VisualNovelSession state sync) is reused untouched.
const BUCKET_MS = 10 * 60 * 1000

export const getStageRoomName = (
  novellaId: string,
  now: number = Date.now()
): string => `${novellaId}-stage-${Math.floor(now / BUCKET_MS)}`

// ─── Turn logic ──────────────────────────────────────────────────────────
export const isRoleTurn = (
  duet: DuetDefinition,
  roleId: string,
  revision: number,
  hasChoices: boolean
): boolean => {
  const roleIndex = duet.roles.findIndex(role => role.id === roleId)

  if (roleIndex === -1) return true // unknown role: never lock anyone out

  switch (duet.turnRule) {
    case 'free':
      return true
    case 'alternate':
      // Works for any role count: the turn cycles through roles by revision.
      return revision % duet.roles.length === roleIndex
    case 'act-tone':
      // Choice beats belong to role[0] (Ink); continue beats to role[1].
      return hasChoices ? roleIndex === 0 : roleIndex === 1
  }
}

// ─── Auto-start leadership (prevents the racing-startStory bug) ──────────
// role[0] starts immediately; each later role waits a staggered grace
// period so exactly one peer lights the story even in same-role pairs.
export const getAutoStartDelayMs = (
  duet: DuetDefinition,
  roleId: string | null
): number => {
  if (roleId === null) return 0

  const roleIndex = duet.roles.findIndex(role => role.id === roleId)

  return roleIndex <= 0 ? 0 : roleIndex * 3000
}
