import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

const peerRooms: PeerRoom[] = []

const createPeerRoom = () => {
  const peerRoom = new PeerRoom({ appId: 'test-app' }, 'room-id')

  peerRooms.push(peerRoom)

  return peerRoom
}

describe('PeerRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.action.onMessage = null
  })

  afterEach(() => {
    for (const peerRoom of peerRooms.splice(0)) {
      peerRoom.leaveRoom()
    }
  })

  test('disconnects only the receiver associated with an unsubscribe callback', () => {
    const peerRoom = createPeerRoom()
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

  test('delivers action messages received before the first receiver connects', () => {
    const peerRoom = createPeerRoom()
    const [, connectReceiver] = peerRoom.makeAction<{ value: string }>(
      PeerAction.PEER_METADATA,
      ActionNamespace.GROUP
    )
    const receiver = vi.fn()

    mocks.action.onMessage?.({ value: 'early' }, { peerId: 'peer-id' })
    connectReceiver(receiver)

    expect(receiver).toHaveBeenCalledWith(
      { value: 'early' },
      { peerId: 'peer-id' }
    )
  })

  test('does not replay messages received after initialized receivers disconnect', () => {
    const peerRoom = createPeerRoom()
    const [, connectReceiver] = peerRoom.makeAction<{ value: string }>(
      PeerAction.MESSAGE,
      ActionNamespace.GROUP
    )
    const firstReceiver = vi.fn()
    const secondReceiver = vi.fn()
    const disconnectFirstReceiver = connectReceiver(firstReceiver)

    disconnectFirstReceiver()
    mocks.action.onMessage?.({ value: 'dropped' }, { peerId: 'peer-id' })
    connectReceiver(secondReceiver)

    expect(firstReceiver).not.toHaveBeenCalled()
    expect(secondReceiver).not.toHaveBeenCalled()
  })

  test('leaves the room exactly once when the page is unloaded', () => {
    const peerRoom = createPeerRoom()

    window.dispatchEvent(new Event('pagehide'))
    peerRoom.leaveRoom()

    expect(mocks.room.leave).toHaveBeenCalledTimes(1)
  })

  test('keeps the room connected when the page enters the back-forward cache', () => {
    createPeerRoom()

    const pageHideEvent = new Event('pagehide')

    Object.defineProperty(pageHideEvent, 'persisted', {
      value: true,
    })

    window.dispatchEvent(pageHideEvent)

    expect(mocks.room.leave).not.toHaveBeenCalled()
  })
})
