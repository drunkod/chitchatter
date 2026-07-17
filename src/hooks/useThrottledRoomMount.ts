import { useEffect, useRef, useState } from 'react'

// Session storage keys for persisting throttling state
export const LAST_MOUNT_TIME_KEY = 'room-mount-throttle:last-mount-time'
export const BACKOFF_KEY = 'room-mount-throttle:backoff'

export const backoffResetPeriod = 5000
export const baseBackoff = 2000
export const backoffMultiplier = 2

// This hook prevents users from rapidly rejoining rooms, which can cause
// WebRTC and peer connections to get into a broken state when leaving and
// rejoining too quickly. It implements exponential backoff to throttle
// successive room mounts.

export function useThrottledRoomMount(roomId: string) {
  const visitRef = useRef({ roomId, id: 0 })

  if (visitRef.current.roomId !== roomId) {
    visitRef.current = {
      roomId,
      id: visitRef.current.id + 1,
    }
  }

  const visitId = visitRef.current.id
  const [allowedVisitId, setAllowedVisitId] = useState<number | null>(null)

  useEffect(() => {
    const now = Date.now()
    const lastMountTime =
      Number(sessionStorage.getItem(LAST_MOUNT_TIME_KEY) || '0') || 0
    const timeSinceLastMount = now - lastMountTime

    sessionStorage.setItem(LAST_MOUNT_TIME_KEY, String(now))

    let backoff = Number(sessionStorage.getItem(BACKOFF_KEY) || '0') || 0

    backoff =
      timeSinceLastMount < backoffResetPeriod
        ? backoff === 0
          ? baseBackoff
          : backoff * backoffMultiplier
        : 0

    sessionStorage.setItem(BACKOFF_KEY, String(backoff))

    const mountTimer =
      backoff > 0
        ? window.setTimeout(() => setAllowedVisitId(visitId), backoff)
        : null

    if (backoff === 0) setAllowedVisitId(visitId)

    const resetTimer = window.setTimeout(() => {
      sessionStorage.setItem(BACKOFF_KEY, '0')
    }, backoff + backoffResetPeriod)

    return () => {
      if (mountTimer !== null) window.clearTimeout(mountTimer)
      window.clearTimeout(resetTimer)
    }
  }, [roomId, visitId])

  return allowedVisitId === visitId
}
