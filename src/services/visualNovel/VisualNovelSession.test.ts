import { getBundledStory } from '../../stories/catalog'

import { VisualNovelEngine } from './VisualNovelEngine'
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

const createStartedState = (controllerPeerId: string, sessionId: string) => {
  const story = getBundledStory('harbour-lights', '1.0.0')

  if (!story) throw new Error('Missing test story')
  return new VisualNovelEngine(story, { now: () => 1000 }).start(
    sessionId,
    controllerPeerId
  )
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
  it('leaves idle peers ready to start after checking for an active session', async () => {
    const { a, b } = connectPair()

    await settle()

    expect(a.getSnapshot()).toMatchObject({
      phase: 'idle',
      pendingRequest: false,
      state: null,
    })
    expect(b.getSnapshot()).toMatchObject({
      phase: 'idle',
      pendingRequest: false,
      state: null,
    })

    a.destroy()
    b.destroy()
  })

  it('keeps recovery active after another bootstrapper reports no state', async () => {
    const network = new TestVisualNovelNetwork()
    const controller = new VisualNovelSession(
      network.createTransport('peer-a'),
      makeDependencies('a')
    )

    controller.connect()
    controller.startStory('harbour-lights', '1.0.0', 'session-a')
    controller.requestAdvance()
    await settle()

    network.dropNext(
      (envelope, fromPeerId, toPeerId) =>
        envelope.actionType === 'STATE_SNAPSHOT' &&
        fromPeerId === 'peer-a' &&
        toPeerId === 'peer-b'
    )
    const b = new VisualNovelSession(
      network.createTransport('peer-b'),
      makeDependencies('b')
    )

    b.connect()
    await settle()
    expect(b.getSnapshot()).toMatchObject({
      state: null,
      pendingRequest: true,
    })

    const c = new VisualNovelSession(
      network.createTransport('peer-c'),
      makeDependencies('c')
    )

    c.connect()
    await settle()

    expect(b.getSnapshot().pendingRequest).toBe(true)
    expect(c.getSnapshot().state).toEqual(controller.getSnapshot().state)

    const snapshotIndex = network
      .getSentMessages()
      .findIndex(
        message =>
          message.envelope.actionType === 'STATE_SNAPSHOT' &&
          message.fromPeerId === 'peer-a' &&
          message.toPeerId === 'peer-b'
      )

    await network.replayMessage(snapshotIndex)
    expect(b.getSnapshot().state).toEqual(controller.getSnapshot().state)

    controller.destroy()
    b.destroy()
    c.destroy()
  })

  it('waits for every expected peer before concluding the room is empty', async () => {
    const network = new TestVisualNovelNetwork()
    const controller = new VisualNovelSession(
      network.createTransport('peer-a'),
      makeDependencies('a')
    )

    controller.connect()
    controller.startStory('harbour-lights', '1.0.0', 'session-a')
    controller.requestAdvance()
    await settle()

    network.dropNext(
      (envelope, fromPeerId, toPeerId) =>
        envelope.actionType === 'STATE_SNAPSHOT' &&
        fromPeerId === 'peer-a' &&
        toPeerId === 'peer-c'
    )
    const emptyPeer = new VisualNovelSession(
      network.createTransport('peer-c'),
      makeDependencies('c')
    )

    emptyPeer.connect()
    await settle()
    expect(emptyPeer.getSnapshot().state).toBeNull()

    network.dropNext(
      (envelope, fromPeerId, toPeerId) =>
        envelope.actionType === 'STATE_SNAPSHOT' &&
        fromPeerId === 'peer-a' &&
        toPeerId === 'peer-b'
    )
    const b = new VisualNovelSession(
      network.createTransport('peer-b'),
      makeDependencies('b')
    )

    b.connect()
    await settle()

    expect(b.getSnapshot()).toMatchObject({
      phase: 'syncing',
      pendingRequest: true,
      state: null,
    })

    controller.destroy()
    emptyPeer.destroy()
    b.destroy()
  })

  it('completes empty recovery after the remaining expected peer leaves', async () => {
    const network = new TestVisualNovelNetwork()

    network.createTransport('silent-peer')
    const emptyPeer = new VisualNovelSession(
      network.createTransport('peer-c'),
      makeDependencies('c')
    )

    emptyPeer.connect()
    const b = new VisualNovelSession(
      network.createTransport('peer-b'),
      makeDependencies('b')
    )

    b.connect()
    await settle()
    expect(b.getSnapshot().pendingRequest).toBe(true)

    network.disconnect('silent-peer')

    expect(b.getSnapshot()).toMatchObject({
      phase: 'idle',
      pendingRequest: false,
      state: null,
    })

    emptyPeer.destroy()
    b.destroy()
  })

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
    const { network, a, b } = connectPair()

    network.dropNext(
      (envelope, fromPeerId, toPeerId) =>
        envelope.actionType === 'SESSION_STARTED' &&
        fromPeerId === 'peer-b' &&
        toPeerId === 'peer-a'
    )
    b.startStory('harbour-lights', '1.0.0', 'session-z')
    await settle()
    expect(a.getSnapshot().state).toBeNull()
    a.startStory('harbour-lights', '1.0.0', 'session-a')
    await settle()

    expect(a.getSnapshot().state).toMatchObject({
      controllerPeerId: 'peer-a',
      sessionId: 'session-a',
    })
    expect(b.getSnapshot().state).toEqual(a.getSnapshot().state)

    const delayedStartIndex = network
      .getSentMessages()
      .findIndex(
        message =>
          message.envelope.actionType === 'SESSION_STARTED' &&
          message.fromPeerId === 'peer-b' &&
          message.toPeerId === 'peer-a'
      )

    expect(delayedStartIndex).toBeGreaterThanOrEqual(0)
    await network.replayMessage(delayedStartIndex)
    expect(a.getSnapshot().state).toEqual(b.getSnapshot().state)

    a.destroy()
    b.destroy()
  })

  it('keeps a progressed session when a lower start arrives late', async () => {
    const { network, a, b } = connectPair()

    a.startStory('harbour-lights', '1.0.0', 'session-a')
    a.requestAdvance()
    await settle()

    const decided = b.getSnapshot().state

    expect(decided?.revision).toBe(1)

    b.startStory('harbour-lights', '1.0.0', 'session-0')
    expect(b.getSnapshot().state).toEqual(decided)

    const lateStart = createStartedState('peer-0', 'session-0')

    await network.send(
      'peer-0',
      {
        protocol: 'visual-novel',
        protocolVersion: 1,
        actionId: 'late-lower-start',
        actionType: 'SESSION_STARTED',
        senderPeerId: 'peer-0',
        sessionId: lateStart.sessionId,
        storyId: lateStart.storyId,
        storyVersion: lateStart.storyVersion,
        revision: lateStart.revision,
        timestamp: 1000,
        payload: { state: lateStart },
      },
      'peer-b'
    )
    await settle()

    expect(b.getSnapshot().state).toEqual(decided)

    a.destroy()
    b.destroy()
  })

  it('accepts a progressed snapshot over a local revision-zero start', async () => {
    const network = new TestVisualNovelNetwork()
    const controller = new VisualNovelSession(
      network.createTransport('peer-z'),
      makeDependencies('z')
    )

    controller.connect()
    controller.startStory('harbour-lights', '1.0.0', 'session-z')
    controller.requestAdvance()
    await settle()

    network.dropNext(
      (envelope, fromPeerId, toPeerId) =>
        envelope.actionType === 'STATE_SNAPSHOT' &&
        fromPeerId === 'peer-z' &&
        toPeerId === 'peer-a'
    )
    const participant = new VisualNovelSession(
      network.createTransport('peer-a'),
      makeDependencies('a')
    )

    participant.connect()
    await settle()
    participant.startStory('harbour-lights', '1.0.0', 'session-a')
    expect(participant.getSnapshot().state).toMatchObject({
      controllerPeerId: 'peer-a',
      revision: 0,
    })

    const snapshotIndex = network
      .getSentMessages()
      .findIndex(
        message =>
          message.envelope.actionType === 'STATE_SNAPSHOT' &&
          message.fromPeerId === 'peer-z' &&
          message.toPeerId === 'peer-a'
      )

    await network.replayMessage(snapshotIndex)

    expect(participant.getSnapshot().state).toEqual(
      controller.getSnapshot().state
    )

    controller.destroy()
    participant.destroy()
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

  it('corrects a stale controller claim before accepting a second claim', async () => {
    const { network, a, b } = connectPair()
    const c = new VisualNovelSession(
      network.createTransport('peer-c'),
      makeDependencies('c')
    )

    c.connect()
    a.startStory('harbour-lights', '1.0.0', 'session-a')
    await settle()

    for (let revision = 1; revision <= 5; revision += 1) {
      a.requestRestart()
      await settle()
    }
    for (let revision = 6; revision <= 7; revision += 1) {
      network.dropNext(
        (envelope, fromPeerId, toPeerId) =>
          envelope.actionType === 'RESTARTED' &&
          fromPeerId === 'peer-a' &&
          toPeerId === 'peer-b'
      )
      a.requestRestart()
      await settle()
    }

    expect(b.getSnapshot().state?.revision).toBe(5)
    expect(c.getSnapshot().state?.revision).toBe(7)

    network.disconnect('peer-a')
    a.destroy()
    b.claimControl()
    await settle()

    expect(b.getSnapshot()).toMatchObject({
      phase: 'paused',
      canClaimControl: true,
      state: { revision: 7, controllerPeerId: 'peer-a' },
    })
    expect(c.getSnapshot()).toMatchObject({
      phase: 'paused',
      state: { revision: 7, controllerPeerId: 'peer-a' },
    })

    b.claimControl()
    await settle()

    expect(b.getSnapshot()).toMatchObject({
      phase: 'active',
      state: { revision: 8, controllerPeerId: 'peer-b' },
    })
    expect(c.getSnapshot().state).toEqual(b.getSnapshot().state)

    b.destroy()
    c.destroy()
  })

  it('recovers a null-state peer after it overhears live traffic', async () => {
    let timeoutHandler: () => void = () => undefined
    const { network, a, b } = connectPair()

    a.startStory('harbour-lights', '1.0.0', 'session-a')
    await settle()
    network.disconnect('peer-a')
    a.destroy()

    const c = new VisualNovelSession(network.createTransport('peer-c'), {
      ...makeDependencies('c'),
      timers: {
        setTimeout: handler => {
          timeoutHandler = handler
          return 1
        },
        clearTimeout: () => undefined,
      },
    })

    c.connect()
    timeoutHandler()
    expect(c.getSnapshot()).toMatchObject({ phase: 'idle', state: null })

    network.dropNext(
      (envelope, fromPeerId, toPeerId) =>
        envelope.actionType === 'CONTROL_CLAIMED' &&
        fromPeerId === 'peer-b' &&
        toPeerId === 'peer-c'
    )
    b.claimControl()
    await settle()
    expect(c.getSnapshot().state).toBeNull()

    b.requestAdvance()
    await settle()

    expect(c.getSnapshot()).toMatchObject({
      phase: 'active',
      state: { controllerPeerId: 'peer-b', revision: 2 },
    })
    expect(c.getSnapshot().state).toEqual(b.getSnapshot().state)

    b.destroy()
    c.destroy()
  })

  it('ends a behind replica without requesting an impossible snapshot', async () => {
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

    a.endSession()
    await settle()

    expect(b.getSnapshot()).toMatchObject({
      phase: 'ended',
      state: null,
      error: null,
      pendingRequest: false,
    })

    a.destroy()
    b.destroy()
  })

  it('ignores stale canonical replay without requesting a snapshot', async () => {
    const { network, a, b } = connectPair()

    a.startStory('harbour-lights', '1.0.0', 'session-a')
    b.requestAdvance()
    await settle()

    const state = b.getSnapshot().state

    expect(state?.revision).toBe(1)
    if (!state) return
    const requestsBefore = network
      .getSentMessages()
      .filter(
        message =>
          message.envelope.actionType === 'STATE_REQUEST' &&
          message.fromPeerId === 'peer-b'
      ).length

    await network.send(
      'peer-a',
      {
        protocol: 'visual-novel',
        protocolVersion: 1,
        actionId: 'old-advanced-replay',
        actionType: 'ADVANCED',
        senderPeerId: 'peer-a',
        sessionId: state.sessionId,
        storyId: state.storyId,
        storyVersion: state.storyVersion,
        revision: 1,
        timestamp: 1000,
        payload: { previousRevision: 0 },
      },
      'peer-b'
    )
    await settle()

    const requestsAfter = network
      .getSentMessages()
      .filter(
        message =>
          message.envelope.actionType === 'STATE_REQUEST' &&
          message.fromPeerId === 'peer-b'
      ).length

    expect(requestsAfter).toBe(requestsBefore)
    expect(b.getSnapshot().state?.revision).toBe(1)

    a.destroy()
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
