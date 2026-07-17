import { beforeEach, describe, expect, test, vi } from 'vitest'

import { PeerAction } from 'models/network'

import { ActionNamespace, PeerRoom } from './PeerRoom'

const mocks = vi.hoisted(() => {
  const action = {
    send: vi.fn(),
    onMessage: null as
      | ((data: { value: string }, context: { peerId: string }) => void)
      | null,
    onReceiveProgress: null,
  }

  return {
    action,
    room: {
      addStream: vi.fn(),
      getPeers: vi.fn(() => ({})),
      leave: vi.fn(),
      makeAction: vi.fn(() => action),
      onPeerJoin: null,
      onPeerLeave: null,
      onPeerStream: null,
      removeStream: vi.fn(),
    },
  }
})

vi.mock('@trystero-p2p/torrent', () => ({
  joinRoom: vi.fn(() => mocks.room),
}))

vi.mock('trystero', () => ({
  joinRoom: vi.fn(),
}))

describe('PeerRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.action.onMessage = null
  })

  test('disconnects only the receiver associated with an unsubscribe callback', () => {
    const peerRoom = new PeerRoom({ appId: 'test-app' }, 'room-id')
    const [, connectReceiver] = peerRoom.makeAction<{ value: string }>(
      PeerAction.MESSAGE,
      ActionNamespace.DIRECT_MESSAGE
    )
    const firstReceiver = vi.fn()
    const secondReceiver = vi.fn()
    const disconnectFirstReceiver = connectReceiver(firstReceiver)

    connectReceiver(secondReceiver)

    mocks.action.onMessage?.({ value: 'first' }, { peerId: 'peer-id' })

    expect(firstReceiver).toHaveBeenCalledTimes(1)
    expect(secondReceiver).toHaveBeenCalledTimes(1)

    disconnectFirstReceiver()
    mocks.action.onMessage?.({ value: 'second' }, { peerId: 'peer-id' })

    expect(firstReceiver).toHaveBeenCalledTimes(1)
    expect(secondReceiver).toHaveBeenCalledTimes(2)
  })
})
