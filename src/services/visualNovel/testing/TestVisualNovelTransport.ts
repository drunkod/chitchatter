import type { VisualNovelActionEnvelope } from '../../../models/visualNovelProtocol'
import type { VisualNovelTransport } from '../VisualNovelTransport'

type MessageHandler = (
  envelope: unknown,
  peerId: string
) => void | Promise<void>

export class TestVisualNovelNetwork {
  private sentMessages: {
    envelope: VisualNovelActionEnvelope
    fromPeerId: string
    toPeerId: string
  }[] = []

  private transports = new Map<string, TestVisualNovelTransport>()

  private dropPredicate:
    | ((
        envelope: VisualNovelActionEnvelope,
        fromPeerId: string,
        toPeerId: string
      ) => boolean)
    | null = null

  createTransport(peerId: string) {
    if (this.transports.has(peerId)) {
      throw new Error(`Duplicate test peer: ${peerId}`)
    }

    const transport = new TestVisualNovelTransport(this, peerId)
    const existing = [...this.transports.values()]
    this.transports.set(peerId, transport)
    existing.forEach(item => item.emitPeerJoin(peerId))
    return transport
  }

  disconnect(peerId: string) {
    if (!this.transports.delete(peerId)) return
    this.transports.forEach(transport => transport.emitPeerLeave(peerId))
  }

  getPeerIds(excludingPeerId: string) {
    return [...this.transports.keys()].filter(
      peerId => peerId !== excludingPeerId
    )
  }

  dropNext(
    predicate: (
      envelope: VisualNovelActionEnvelope,
      fromPeerId: string,
      toPeerId: string
    ) => boolean
  ) {
    this.dropPredicate = predicate
  }

  async send(
    fromPeerId: string,
    envelope: VisualNovelActionEnvelope,
    targetPeerId?: string
  ) {
    const targets = targetPeerId ? [targetPeerId] : this.getPeerIds(fromPeerId)

    for (const toPeerId of targets) {
      const target = this.transports.get(toPeerId)
      if (!target) continue
      this.sentMessages.push({
        envelope: structuredClone(envelope),
        fromPeerId,
        toPeerId,
      })
      if (this.dropPredicate?.(envelope, fromPeerId, toPeerId)) {
        this.dropPredicate = null
        continue
      }
      await target.emitMessage(structuredClone(envelope), fromPeerId)
    }
  }

  getSentMessages() {
    return this.sentMessages.map(message => structuredClone(message))
  }

  async replayMessage(index: number) {
    const message = this.sentMessages[index]
    if (!message) throw new Error('Unknown test message')
    const target = this.transports.get(message.toPeerId)
    await target?.emitMessage(
      structuredClone(message.envelope),
      message.fromPeerId
    )
  }
}

export class TestVisualNovelTransport implements VisualNovelTransport {
  private messageHandlers = new Set<MessageHandler>()

  private joinHandlers = new Set<(peerId: string) => void>()

  private leaveHandlers = new Set<(peerId: string) => void>()

  constructor(
    private readonly network: TestVisualNovelNetwork,
    private readonly peerId: string
  ) {}

  getSelfId = () => this.peerId

  getPeers = () => this.network.getPeerIds(this.peerId)

  send = (envelope: VisualNovelActionEnvelope, targetPeerId?: string) =>
    this.network.send(this.peerId, envelope, targetPeerId)

  subscribe = (handler: MessageHandler) => {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  onPeerJoin = (handler: (peerId: string) => void) => {
    this.joinHandlers.add(handler)
    return () => this.joinHandlers.delete(handler)
  }

  onPeerLeave = (handler: (peerId: string) => void) => {
    this.leaveHandlers.add(handler)
    return () => this.leaveHandlers.delete(handler)
  }

  emitMessage = async (envelope: unknown, peerId: string) => {
    for (const handler of this.messageHandlers) {
      await handler(envelope, peerId)
    }
  }

  emitPeerJoin = (peerId: string) => {
    this.joinHandlers.forEach(handler => handler(peerId))
  }

  emitPeerLeave = (peerId: string) => {
    this.leaveHandlers.forEach(handler => handler(peerId))
  }
}
