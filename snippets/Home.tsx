// Target: src/pages/Home/Home.tsx
//
// Auto-join an anonymous public room. useHome() already generates a random
// UUID room name on mount, so we just navigate immediately instead of
// rendering the form. A ref guards against double-navigation under
// React 18 StrictMode.
//
// If you want to keep the original home page available, gate on
// `minimalUi.autoJoinPublicRoom` from 'config/minimalMode' and fall through
// to the original JSX when it is false.

import { useEffect, useRef } from 'react'

import { WholePageLoading } from 'components/Loading'

import { useHome } from './useHome'

export interface HomeProps {
  userId: string
}

export function Home({ userId: _userId }: HomeProps) {
  const { handleJoinPublicRoomClick, isRoomNameValid } = useHome()
  const hasNavigated = useRef(false)

  useEffect(() => {
    if (hasNavigated.current || !isRoomNameValid) return

    hasNavigated.current = true
    handleJoinPublicRoomClick() // navigate(`/public/${roomName}`)
  }, [handleJoinPublicRoomClick, isRoomNameValid])

  return <WholePageLoading />
}
