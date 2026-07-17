import { useEffect, useMemo, useSyncExternalStore } from 'react'

import type { PeerRoom } from '../../lib/PeerRoom'
import {
  PeerRoomVisualNovelTransport,
  VisualNovelSession,
} from '../../services/visualNovel'

export const useVisualNovelRoom = (peerRoom: PeerRoom) => {
  const session = useMemo(
    () => new VisualNovelSession(new PeerRoomVisualNovelTransport(peerRoom)),
    [peerRoom]
  )

  useEffect(() => {
    session.connect()
    return () => session.destroy()
  }, [session])

  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  )

  return { session, snapshot }
}
