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

  const fragment = window.location.hash.substring(1)
  const [secret, setSecret] = useState('')
  const activeRoomIdRef = useRef(roomId)

  useEffect(() => {
    activeRoomIdRef.current = roomId

    const urlParams = new URLSearchParams(fragment)
    let isCancelled = false

    setSecret('')

    if (allowAdvancedRoomLinkSharing && fragment.length > 0) {
      // Clear secret from address bar
      window.history.replaceState(window.history.state, '', '#')
    }

    const secretParam = urlParams.get('secret')

    if (secretParam) {
      setSecret(secretParam)
      return
    }

    const legacyPassword = urlParams.get('pwd')

    if (!legacyPassword) return

    encryption.encodePassword(roomId, legacyPassword).then(encodedPassword => {
      if (!isCancelled) setSecret(encodedPassword)
    })

    return () => {
      isCancelled = true
    }
  }, [fragment, roomId])

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
      setSecret(encodedPassword)
    }
  }

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
    <Room userId={userId} roomId={roomId} password={secret} />
  )
}
