import {
  ActionNamespace,
  PeerHookType,
  type PeerRoom,
} from '../../lib/PeerRoom'
import type { VisualNovelActionEnvelope } from '../../models/visualNovelProtocol'
import { PeerAction } from '../../models/network'

import type { VisualNovelTransport } from './VisualNovelTransport'

export class PeerRoomVisualNovelTransport implements VisualNovelTransport {
  private readonly sendAction

  private readonly connectReceiver

  constructor(private readonly peerRoom: PeerRoom) {
    const [sendAction, connectReceiver] =
      peerRoom.makeAction<VisualNovelActionEnvelope>(
        PeerAction.VISUAL_NOVEL,
        ActionNamespace.GROUP
      )

    this.sendAction = sendAction
    this.connectReceiver = connectReceiver
  }

  getSelfId = () => this.peerRoom.getSelfId()

  getPeers = () => this.peerRoom.getPeers()

  send = async (envelope: VisualNovelActionEnvelope, targetPeerId?: string) => {
    await this.sendAction(
      envelope,
      targetPeerId ? { target: targetPeerId } : undefined
    )
  }

  subscribe: VisualNovelTransport['subscribe'] = handler =>
    this.connectReceiver((envelope, { peerId }) => handler(envelope, peerId))

  onPeerJoin: VisualNovelTransport['onPeerJoin'] = handler => {
    this.peerRoom.onPeerJoin(PeerHookType.VISUAL_NOVEL, handler)
    return () => this.peerRoom.removePeerJoinHandler(PeerHookType.VISUAL_NOVEL)
  }

  onPeerLeave: VisualNovelTransport['onPeerLeave'] = handler => {
    this.peerRoom.onPeerLeave(PeerHookType.VISUAL_NOVEL, handler)
    return () => this.peerRoom.removePeerLeaveHandler(PeerHookType.VISUAL_NOVEL)
  }
}
