import { Room } from 'components/Room'
import { useContext, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import { WholePageLoading } from 'components/Loading'
import { PasswordPrompt } from 'components/PasswordPrompt'
import { allowAdvancedRoomLinkSharing } from 'components/Shell/constants'
import { ShellContext } from 'contexts/ShellContext'
import { useThrottledRoomMount } from 'hooks/useThrottledRoomMount'
import { encryption } from 'services/Encryption'
import { notification } from 'services/Notification'

interface PublicRoomProps {
  userId: string
}

export function PrivateRoom({ userId }: PublicRoomProps) {
  const { roomId = '' } = useParams()
  const { setTitle } = useContext(ShellContext)
  const canMount = useThrottledRoomMount(roomId)

  const [secretState, setSecretState] = useState({ roomId, value: '' })
  const activeRoomIdRef = useRef(roomId)

  useEffect(() => {
    activeRoomIdRef.current = roomId

    const fragmentSnapshot = window.location.hash.substring(1)
    const urlParams = new URLSearchParams(fragmentSnapshot)
    let isCancelled = false

    setSecretState({ roomId, value: '' })

    if (allowAdvancedRoomLinkSharing && fragmentSnapshot.length > 0) {
      // Clear secret from address bar
      window.history.replaceState(window.history.state, '', '#')
    }

    const secretParam = urlParams.get('secret')

    if (secretParam) {
      setSecretState({ roomId, value: secretParam })
      return
    }

    const legacyPassword = urlParams.get('pwd')

    if (!legacyPassword) return

    encryption.encodePassword(roomId, legacyPassword).then(encodedPassword => {
      if (!isCancelled) setSecretState({ roomId, value: encodedPassword })
    })

    return () => {
      isCancelled = true
    }
  }, [roomId])

  useEffect(() => {
    notification.requestPermission()
  }, [])

  useEffect(() => {
    setTitle(`Room: ${roomId}`)
  }, [roomId, setTitle])

  const handlePasswordEntered = async (password: string) => {
    if (password.length === 0) return

    const encodedPassword = await encryption.encodePassword(roomId, password)

    if (activeRoomIdRef.current === roomId) {
      setSecretState({ roomId, value: encodedPassword })
    }
  }

  const secret = secretState.roomId === roomId ? secretState.value : ''
  const awaitingSecret = secret.length === 0

  if (!canMount) {
    return <WholePageLoading />
  }

  return awaitingSecret ? (
    <PasswordPrompt
      isOpen={awaitingSecret}
      onPasswordEntered={handlePasswordEntered}
    />
  ) : (
    <Room
      key={`${roomId}:${secret}`}
      userId={userId}
      roomId={roomId}
      password={secret}
    />
  )
}
