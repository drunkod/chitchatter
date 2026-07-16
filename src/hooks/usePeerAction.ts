import { PeerRoom } from 'lib/PeerRoom'
import { PeerAction } from 'models/network'
import { useEffect, useState } from 'react'
import { DataPayload, MessageContext } from 'trystero'
import { ActionProgress, ActionSender } from 'lib/PeerRoom'

export const usePeerAction = <T extends DataPayload>({
  peerRoom,
  peerAction,
  onReceive,
  namespace,
}: {
  peerRoom: PeerRoom
  peerAction: PeerAction
  onReceive: (data: T, context: MessageContext) => void | Promise<void>
  namespace: string
}): [ActionSender<T>, ActionProgress] => {
  const [[sender, connectReceiver, progress]] = useState(() =>
    peerRoom.makeAction<T>(peerAction, namespace)
  )

  useEffect(() => {
    return connectReceiver(onReceive)
  }, [onReceive, connectReceiver])

  return [sender, progress]
}
