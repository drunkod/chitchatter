import type { VisualNovelActionEnvelope } from '../../models/visualNovelProtocol'

export interface VisualNovelTransport {
  getSelfId(): string
  getPeers(): string[]
  send(
    envelope: VisualNovelActionEnvelope,
    targetPeerId?: string
  ): Promise<void>
  subscribe(
    handler: (envelope: unknown, peerId: string) => void | Promise<void>
  ): () => void
  onPeerJoin(handler: (peerId: string) => void): () => void
  onPeerLeave(handler: (peerId: string) => void): () => void
}
