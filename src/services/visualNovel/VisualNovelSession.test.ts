import { getBundledStory } from '../../stories/catalog'
import { VisualNovelSession } from './VisualNovelSession'
import { TestVisualNovelNetwork } from './testing/TestVisualNovelTransport'

const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

const makeDependencies = (peerId: string) => {
  let id = 0
  return {
    createId: () => `${peerId}-${++id}`,
    now: () => 1000 + id,
    timers: {
      setTimeout: (handler: () => void, timeoutMs: number) =>
        setTimeout(handler, timeoutMs),
      clearTimeout: (timer: unknown) =>
        clearTimeout(timer as ReturnType<typeof setTimeout>),
    },
    resolveStory: getBundledStory,
  }
}

const connectPair = () => {
  const network = new TestVisualNovelNetwork()
  const a = new VisualNovelSession(
    network.createTransport('peer-a'),
    makeDependencies('a')
  )
  const b = new VisualNovelSession(
    network.createTransport('peer-b'),
    makeDependencies('b')
  )
  a.connect()
  b.connect()
  return { network, a, b }
}

describe('VisualNovelSession', () => {
  it('round-trips participant actions through the controller', async () => {
    const { a, b } = connectPair()

    a.startStory('harbour-lights', '1.0.0', 'session-a')
    await settle()
    expect(a.getSnapshot().state?.revision).toBe(0)
    expect(b.getSnapshot().state?.revision).toBe(0)

    b.requestAdvance()
    await settle()
    expect(a.getSnapshot().state?.dialogueEntryId).toBe('pier-2')
    expect(b.getSnapshot().state?.dialogueEntryId).toBe('pier-2')

    b.requestChoice('light-beacon')
    await settle()
    expect(a.getSnapshot().state).toMatchObject({
      sceneId: 'beacon-ending',
      revision: 2,
    })
    expect(b.getSnapshot().state).toEqual(a.getSnapshot().state)

    a.destroy()
    b.destroy()
  })

  it('recovers a late joiner with a targeted snapshot', async () => {
    const { network, a, b } = connectPair()
    a.startStory('harbour-lights', '1.0.0', 'session-a')
    b.requestAdvance()
    await settle()

    const c = new VisualNovelSession(
      network.createTransport('peer-c'),
      makeDependencies('c')
    )
    c.connect()
    await settle()

    expect(c.getSnapshot().state).toEqual(a.getSnapshot().state)
    expect(c.getSnapshot().phase).toBe('active')

    a.destroy()
    b.destroy()
    c.destroy()
  })

  it('requests a snapshot after a revision gap', async () => {
    const { network, a, b } = connectPair()
    a.startStory('harbour-lights', '1.0.0', 'session-a')
    await settle()

    network.dropNext(
      (envelope, fromPeerId, toPeerId) =>
        envelope.actionType === 'ADVANCED' &&
        fromPeerId === 'peer-a' &&
        toPeerId === 'peer-b'
    )
    b.requestAdvance()
    await settle()
    expect(a.getSnapshot().state?.revision).toBe(1)
    expect(b.getSnapshot().state?.revision).toBe(0)

    a.requestChoice('light-beacon')
    await settle()
    expect(b.getSnapshot().state?.revision).toBe(2)
    expect(b.getSnapshot().state).toEqual(a.getSnapshot().state)

    a.destroy()
    b.destroy()
  })

  it('pauses after controller departure and lets the lowest peer claim', async () => {
    const { network, a, b } = connectPair()
    const c = new VisualNovelSession(
      network.createTransport('peer-c'),
      makeDependencies('c')
    )
    c.connect()
    a.startStory('harbour-lights', '1.0.0', 'session-a')
    await settle()

    network.disconnect('peer-a')
    expect(b.getSnapshot()).toMatchObject({
      phase: 'paused',
      canClaimControl: true,
    })
    expect(c.getSnapshot()).toMatchObject({
      phase: 'paused',
      canClaimControl: false,
    })

    b.claimControl()
    await settle()
    expect(b.getSnapshot().state?.controllerPeerId).toBe('peer-b')
    expect(c.getSnapshot().state?.controllerPeerId).toBe('peer-b')
    expect(c.getSnapshot().phase).toBe('active')

    a.destroy()
    b.destroy()
    c.destroy()
  })

  it('uses the lower controller/session tuple for competing starts', async () => {
    const { a, b } = connectPair()

    b.startStory('harbour-lights', '1.0.0', 'session-z')
    await settle()
    a.startStory('harbour-lights', '1.0.0', 'session-a')
    await settle()

    expect(a.getSnapshot().state).toMatchObject({
      controllerPeerId: 'peer-a',
      sessionId: 'session-a',
    })
    expect(b.getSnapshot().state).toEqual(a.getSnapshot().state)

    a.destroy()
    b.destroy()
  })

  it('ignores duplicate action delivery', async () => {
    const { network, a, b } = connectPair()
    a.startStory('harbour-lights', '1.0.0', 'session-a')
    b.requestAdvance()
    await settle()

    const messages = network.getSentMessages()
    const advancedIndex = messages.findIndex(
      message =>
        message.envelope.actionType === 'ADVANCED' &&
        message.toPeerId === 'peer-b'
    )
    expect(advancedIndex).toBeGreaterThanOrEqual(0)
    await network.replayMessage(advancedIndex)

    expect(b.getSnapshot().state?.revision).toBe(1)

    a.destroy()
    b.destroy()
  })

  it('surfaces snapshot request timeout', () => {
    let timeoutHandler: () => void = () => undefined
    const network = new TestVisualNovelNetwork()
    network.createTransport('silent-peer')
    const session = new VisualNovelSession(network.createTransport('peer-a'), {
      ...makeDependencies('a'),
      timers: {
        setTimeout: handler => {
          timeoutHandler = handler
          return 1
        },
        clearTimeout: () => undefined,
      },
    })

    session.connect()
    expect(session.getSnapshot().pendingRequest).toBe(true)
    timeoutHandler()
    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      pendingRequest: false,
      error: 'The latest novella state could not be recovered in time',
    })

    session.destroy()
  })

  it('re-enables participant controls after a command timeout', async () => {
    let timeoutHandler: () => void = () => undefined
    const network = new TestVisualNovelNetwork()
    const a = new VisualNovelSession(
      network.createTransport('peer-a'),
      makeDependencies('a')
    )
    const b = new VisualNovelSession(network.createTransport('peer-b'), {
      ...makeDependencies('b'),
      timers: {
        setTimeout: handler => {
          timeoutHandler = handler
          return 1
        },
        clearTimeout: () => undefined,
      },
    })
    a.connect()
    b.connect()
    a.startStory('harbour-lights', '1.0.0', 'session-a')
    await settle()

    network.dropNext(
      (envelope, fromPeerId, toPeerId) =>
        envelope.actionType === 'ADVANCE_REQUEST' &&
        fromPeerId === 'peer-b' &&
        toPeerId === 'peer-a'
    )
    b.requestAdvance()
    expect(b.getSnapshot().pendingRequest).toBe(true)

    timeoutHandler()
    expect(b.getSnapshot()).toMatchObject({
      phase: 'active',
      pendingRequest: false,
      error: 'The storyteller did not respond in time',
    })

    a.destroy()
    b.destroy()
  })

  it('resumes when the departed controller rejoins before a claim', async () => {
    const { network, a, b } = connectPair()
    a.startStory('harbour-lights', '1.0.0', 'session-a')
    await settle()

    network.disconnect('peer-a')
    a.destroy()
    expect(b.getSnapshot().phase).toBe('paused')

    network.createTransport('peer-a')
    expect(b.getSnapshot()).toMatchObject({
      phase: 'active',
      canClaimControl: false,
    })

    b.destroy()
  })

  it('does not suppress an out-of-order event before it can apply', async () => {
    const { network, a, b } = connectPair()
    a.startStory('harbour-lights', '1.0.0', 'session-a')
    await settle()

    const state = a.getSnapshot().state
    expect(state).not.toBeNull()
    if (!state) return
    const restarted = {
      protocol: 'visual-novel' as const,
      protocolVersion: 1 as const,
      actionId: 'out-of-order-restarted',
      actionType: 'RESTARTED' as const,
      senderPeerId: 'peer-a',
      sessionId: state.sessionId,
      storyId: state.storyId,
      storyVersion: state.storyVersion,
      revision: 2,
      timestamp: 1000,
      payload: { previousRevision: 1 },
    }

    await network.send('peer-a', restarted, 'peer-b')
    await settle()
    expect(b.getSnapshot().state?.revision).toBe(0)

    b.requestAdvance()
    await settle()
    expect(b.getSnapshot().state?.revision).toBe(1)

    await network.send('peer-a', restarted, 'peer-b')
    await settle()
    expect(b.getSnapshot().state).toMatchObject({
      revision: 2,
      sceneId: 'pier',
      dialogueEntryId: 'pier-1',
    })

    a.destroy()
    b.destroy()
  })
})
