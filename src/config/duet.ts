// Roles, pairing, and turn logic for Two Lanterns.
//
// E2E tests require classic UI (no duet mode), so isDuetMode is auto-off
// when VITE_IS_E2E_TEST is set.

const isE2ETest =
  import.meta.env.VITE_IS_E2E_TEST === 'true' ||
  import.meta.env.VITE_IS_E2E_TEST === '1'

const duetFlag = import.meta.env.VITE_DUET_MODE

export const isDuetMode: boolean =
  duetFlag === 'true' || duetFlag === '1'
    ? true
    : !isE2ETest && duetFlag !== 'false'

export type DuetRole = 'keeper' | 'sailor'

export const DUET_ROLES: Record<
  DuetRole,
  { title: string; tagline: string; turnHint: string }
> = {
  keeper: {
    title: 'The Keeper',
    tagline: 'You tend the light on the cliff. Someone is out there.',
    turnHint: 'The lantern is with the Sailor…',
  },
  sailor: {
    title: 'The Sailor',
    tagline: 'You ride the dark water. Someone is watching for you.',
    turnHint: 'The lantern is with the Keeper…',
  },
}

const STORAGE_KEY = 'two-lanterns-role'

export const setDuetRole = (role: DuetRole) => {
  window.sessionStorage.setItem(STORAGE_KEY, role)
}

export const getDuetRole = (): DuetRole | null => {
  const value = window.sessionStorage.getItem(STORAGE_KEY)

  if (value === 'keeper' || value === 'sailor') {
    return value
  }
  return null
}

// ─── Anonymous pairing without a server ──────────────────────────────────
// Everyone who picks a character in the same 10-minute window lands in the
// same deterministic public room. Zero infrastructure; stale rooms expire
// as the bucket rolls over.
//
// To soften the 10-minute boundary split (late joiners miss early players),
// also try the previous bucket for a grace period. Wire into CharacterSelect:
//   const buckets = [getStageRoomName(), getStageRoomName(Date.now() - BUCKET_MS)]
const BUCKET_MS = 10 * 60 * 1000

export const getStageRoomName = (now: number = Date.now()): string =>
  `two-lanterns-stage-${Math.floor(now / BUCKET_MS)}`

export const getPreviousBucketRoomName = (now: number = Date.now()): string =>
  `two-lanterns-stage-${Math.floor(now / BUCKET_MS) - 1}`

// ─── The duet mechanic ───────────────────────────────────────────────────
// The "lantern" (the turn) passes back and forth. Story revisions alternate:
// the Keeper acts on even revisions, the Sailor on odd ones. Works with any
// story — no story-data changes needed.
export const isRoleTurn = (role: DuetRole, revision: number): boolean =>
  revision % 2 === (role === 'keeper' ? 0 : 1)
