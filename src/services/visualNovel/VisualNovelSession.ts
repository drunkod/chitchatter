import { visualNovelLimits } from '../../config/visualNovel'
import type {
  VisualNovelManifest,
  VisualNovelSessionState,
} from '../../models/visualNovel'
import type {
  VisualNovelActionEnvelope,
  VisualNovelActionType,
  VisualNovelEnvelopeFor,
  VisualNovelPayloadByAction,
  VisualNovelRecoveryReason,
  VisualNovelRuntimeSnapshot,
} from '../../models/visualNovelProtocol'
import { getBundledStory } from '../../stories/catalog'
import { VisualNovelEngine } from './VisualNovelEngine'
import { validateVisualNovelEnvelope } from './VisualNovelProtocol'
import { toSnapshotState } from './VisualNovelValidator'
import type { VisualNovelTransport } from './VisualNovelTransport'

interface TimerApi {
  setTimeout(handler: () => void, timeoutMs: number): unknown
  clearTimeout(timer: unknown): void
}

export interface VisualNovelSessionDependencies {
  createId: () => string
  now: () => number
  timers: TimerApi
  resolveStory: (
    storyId: string,
    storyVersion: string
  ) => VisualNovelManifest | null
}

interface CommandRequest {
  actionId: string
  timer: unknown
}

interface RecoveryRequest {
  actionId: string
  targetPeerId: string | null
  timer: unknown
}

const defaultDependencies: VisualNovelSessionDependencies = {
  createId: () => crypto.randomUUID(),
  now: () => Date.now(),
  timers: {
    setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
    clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  },
  resolveStory: getBundledStory,
}

const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const compareStartIdentity = (
  a: Pick<VisualNovelSessionState, 'controllerPeerId' | 'sessionId'>,
  b: Pick<VisualNovelSessionState, 'controllerPeerId' | 'sessionId'>
) =>
  compareId(a.controllerPeerId, b.controllerPeerId) ||
  compareId(a.sessionId, b.sessionId)

const sameSubject = (
  state: VisualNovelSessionState,
  envelope: VisualNovelActionEnvelope
) =>
  envelope.sessionId === state.sessionId &&
  envelope.storyId === state.storyId &&
  envelope.storyVersion === state.storyVersion

export class VisualNovelSession {
  private state: VisualNovelSessionState | null = null

  private phase: VisualNovelRuntimeSnapshot['phase'] = 'idle'

  private error: string | null = null

  private listeners = new Set<() => void>()

  private seenActionIds = new Set<string>()

  private seenActionOrder: string[] = []

  private recovery: RecoveryRequest | null = null

  private commandRequest: CommandRequest | null = null

  private lastSnapshotRequestActionId: string | null = null

  private lastSnapshotRequestTargetPeerId: string | null = null

  private lastControlClaimActionId: string | null = null

  private unsubscribeMessage: (() => void) | null = null

  private unsubscribeJoin: (() => void) | null = null

  private unsubscribeLeave: (() => void) | null = null

  private connected = false

  private snapshot: VisualNovelRuntimeSnapshot = {
    phase: 'idle',
    state: null,
    error: null,
    isController: false,
    canClaimControl: false,
    pendingRequest: false,
  }

  constructor(
    private readonly transport: VisualNovelTransport,
    private readonly dependencies: VisualNovelSessionDependencies = defaultDependencies
  ) {}

  connect = () => {
    if (this.connected) return
    this.connected = true
    this.unsubscribeMessage = this.transport.subscribe(this.receive)
    this.unsubscribeJoin = this.transport.onPeerJoin(this.handlePeerJoin)
    this.unsubscribeLeave = this.transport.onPeerLeave(this.handlePeerLeave)

    if (this.transport.getPeers().length > 0) {
      this.requestSnapshot('join')
    }
  }

  destroy = () => {
    this.connected = false
    this.unsubscribeMessage?.()
    this.unsubscribeJoin?.()
    this.unsubscribeLeave?.()
    this.unsubscribeMessage = null
    this.unsubscribeJoin = null
    this.unsubscribeLeave = null
    this.clearRecovery()
    this.clearCommandRequest()
    this.listeners.clear()
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.snapshot

  startStory = (
    storyId: string,
    storyVersion: string,
    sessionId = this.dependencies.createId()
  ) => {
    if (this.state) return

    const story = this.dependencies.resolveStory(storyId, storyVersion)
    if (!story) {
      this.fail('The selected story is unavailable')
      return
    }

    const engine = this.createEngine(story)
    const candidate = engine.start(sessionId, this.transport.getSelfId())

    this.installState(candidate)
    void this.send('SESSION_STARTED', { state: candidate }, candidate)
  }

  requestAdvance = () => {
    if (!this.state || this.phase === 'paused') return
    if (this.isController()) {
      this.commitAdvance()
      return
    }

    this.sendCommand(
      'ADVANCE_REQUEST',
      { expectedRevision: this.state.revision },
      this.state.controllerPeerId
    )
  }

  requestChoice = (choiceId: string) => {
    if (!this.state || this.phase === 'paused') return
    if (this.isController()) {
      this.commitChoice(choiceId)
      return
    }

    this.sendCommand(
      'CHOICE_REQUEST',
      { choiceId, expectedRevision: this.state.revision },
      this.state.controllerPeerId
    )
  }

  requestRestart = () => {
    if (!this.state || this.phase === 'paused') return
    if (this.isController()) {
      this.commitRestart()
      return
    }

    this.sendCommand(
      'RESTART_REQUEST',
      { expectedRevision: this.state.revision },
      this.state.controllerPeerId
    )
  }

  endSession = () => {
    if (!this.state || !this.isController()) return
    const previousState = this.state
    void this.send(
      'SESSION_ENDED',
      { previousRevision: previousState.revision },
      previousState
    )
    this.state = null
    this.phase = 'ended'
    this.error = null
    this.clearRecovery()
    this.clearCommandRequest()
    this.emit()
  }

  claimControl = () => {
    if (!this.state || !this.canClaimControl()) return
    const previousControllerPeerId = this.state.controllerPeerId
    const engine = this.engineForState(this.state)
    if (!engine) return

    const changed = engine.changeController(
      this.state,
      this.transport.getSelfId()
    )
    const envelope = this.envelopeFor(
      'CONTROL_CLAIMED',
      { previousControllerPeerId, state: toSnapshotState(changed) },
      changed
    )
    this.rememberAction(envelope.actionId)
    this.lastControlClaimActionId = envelope.actionId
    this.installState(changed)
    void this.transport.send(envelope).catch(error => {
      console.error(error)
      this.warn('The controller claim could not be broadcast')
    })
  }

  retryRecovery = () => {
    const target = this.state?.controllerPeerId ?? undefined
    this.requestSnapshot('timeout', target)
  }

  private emit = () => {
    this.snapshot = {
      phase: this.phase,
      state: this.state,
      error: this.error,
      isController: this.isController(),
      canClaimControl: this.canClaimControl(),
      pendingRequest: this.recovery !== null || this.commandRequest !== null,
    }
    this.listeners.forEach(listener => listener())
  }

  private fail = (message: string) => {
    this.error = message
    this.phase = 'error'
    this.emit()
  }

  private warn = (message: string) => {
    this.error = message
    this.emit()
  }

  private isController = () =>
    this.state?.controllerPeerId === this.transport.getSelfId()

  private canClaimControl = () => {
    if (!this.state || this.phase !== 'paused') return false
    if (this.connectedPeerIds().includes(this.state.controllerPeerId)) {
      return false
    }
    return this.lowestConnectedPeerId() === this.transport.getSelfId()
  }

  private connectedPeerIds = () => [
    this.transport.getSelfId(),
    ...this.transport.getPeers(),
  ]

  private lowestConnectedPeerId = () =>
    [...new Set(this.connectedPeerIds())].sort(compareId)[0]

  private createEngine = (story: VisualNovelManifest) =>
    new VisualNovelEngine(story, { now: this.dependencies.now })

  private engineForState = (state: VisualNovelSessionState) => {
    const story = this.dependencies.resolveStory(
      state.storyId,
      state.storyVersion
    )
    if (!story) {
      this.fail('The room is using an unavailable story')
      return null
    }
    return this.createEngine(story)
  }

  private installState = (state: VisualNovelSessionState) => {
    this.state = state
    this.error = null
    this.phase = this.controllerIsPresent(state) ? 'active' : 'paused'
    this.clearRecovery()
    this.clearCommandRequest()
    this.emit()
  }

  private controllerIsPresent = (state: VisualNovelSessionState) =>
    state.controllerPeerId === this.transport.getSelfId() ||
    this.transport.getPeers().includes(state.controllerPeerId)

  private rememberAction = (actionId: string) => {
    if (this.seenActionIds.has(actionId)) return false
    this.seenActionIds.add(actionId)
    this.seenActionOrder.push(actionId)
    while (this.seenActionOrder.length > visualNovelLimits.maxSeenActionIds) {
      const removed = this.seenActionOrder.shift()
      if (removed) this.seenActionIds.delete(removed)
    }
    return true
  }

  private envelopeFor = <T extends VisualNovelActionType>(
    actionType: T,
    payload: VisualNovelPayloadByAction[T],
    state: VisualNovelSessionState | null
  ): VisualNovelEnvelopeFor<T> => ({
    protocol: 'visual-novel',
    protocolVersion: 1,
    actionId: this.dependencies.createId(),
    actionType,
    senderPeerId: this.transport.getSelfId(),
    sessionId: state?.sessionId ?? null,
    storyId: state?.storyId ?? null,
    storyVersion: state?.storyVersion ?? null,
    revision: state?.revision ?? -1,
    timestamp: this.dependencies.now(),
    payload,
  })

  private send = async <T extends VisualNovelActionType>(
    actionType: T,
    payload: VisualNovelPayloadByAction[T],
    state: VisualNovelSessionState | null,
    targetPeerId?: string
  ) => {
    const envelope = this.envelopeFor(actionType, payload, state)
    this.rememberAction(envelope.actionId)
    try {
      await this.transport.send(envelope, targetPeerId)
    } catch (error) {
      console.error(error)
      this.warn('The novella message could not be sent')
    }
    return envelope
  }

  private sendCommand = <
    T extends 'ADVANCE_REQUEST' | 'CHOICE_REQUEST' | 'RESTART_REQUEST',
  >(
    actionType: T,
    payload: VisualNovelPayloadByAction[T],
    targetPeerId: string
  ) => {
    if (!this.state || this.commandRequest) return
    const envelope = this.envelopeFor(actionType, payload, this.state)
    this.rememberAction(envelope.actionId)
    this.error = null

    const commandRequest: CommandRequest = {
      actionId: envelope.actionId,
      timer: 0,
    }
    commandRequest.timer = this.dependencies.timers.setTimeout(() => {
      if (this.commandRequest?.actionId !== commandRequest.actionId) return
      this.commandRequest = null
      this.error = 'The storyteller did not respond in time'
      if (!this.recovery) {
        this.phase = this.state ? 'active' : 'idle'
      }
      this.emit()
    }, visualNovelLimits.requestTimeoutMs)
    this.commandRequest = commandRequest
    this.emit()

    void this.transport.send(envelope, targetPeerId).catch(error => {
      console.error(error)
      if (this.commandRequest?.actionId === envelope.actionId) {
        this.clearCommandRequest()
        this.fail('The novella request could not be sent')
      }
    })
  }

  private receive = async (input: unknown, peerId: string) => {
    const result = validateVisualNovelEnvelope(
      input,
      peerId,
      this.dependencies.resolveStory
    )
    if (!result.ok) {
      console.warn('Discarded invalid visual novel message', result.errors)
      return
    }

    const envelope = result.value
    if (this.seenActionIds.has(envelope.actionId)) return

    if (
      !this.state &&
      !this.recovery &&
      envelope.sessionId !== null &&
      envelope.actionType !== 'STATE_REQUEST' &&
      envelope.actionType !== 'STATE_SNAPSHOT' &&
      envelope.actionType !== 'SESSION_STARTED' &&
      envelope.actionType !== 'SESSION_ENDED' &&
      this.phase !== 'ended'
    ) {
      this.requestSnapshot('gap', envelope.senderPeerId)
    }

    let handled = false
    switch (envelope.actionType) {
      case 'SESSION_STARTED':
        handled = this.receiveSessionStarted(
          envelope as VisualNovelEnvelopeFor<'SESSION_STARTED'>
        )
        break
      case 'STATE_REQUEST':
        handled = this.receiveStateRequest(
          envelope as VisualNovelEnvelopeFor<'STATE_REQUEST'>
        )
        break
      case 'STATE_SNAPSHOT':
        handled = this.receiveStateSnapshot(
          envelope as VisualNovelEnvelopeFor<'STATE_SNAPSHOT'>
        )
        break
      case 'ADVANCE_REQUEST':
        handled = this.receiveAdvanceRequest(
          envelope as VisualNovelEnvelopeFor<'ADVANCE_REQUEST'>
        )
        break
      case 'ADVANCED':
        handled = this.receiveAdvanced(
          envelope as VisualNovelEnvelopeFor<'ADVANCED'>
        )
        break
      case 'CHOICE_REQUEST':
        handled = this.receiveChoiceRequest(
          envelope as VisualNovelEnvelopeFor<'CHOICE_REQUEST'>
        )
        break
      case 'CHOICE_RESOLVED':
        handled = this.receiveChoiceResolved(
          envelope as VisualNovelEnvelopeFor<'CHOICE_RESOLVED'>
        )
        break
      case 'RESTART_REQUEST':
        handled = this.receiveRestartRequest(
          envelope as VisualNovelEnvelopeFor<'RESTART_REQUEST'>
        )
        break
      case 'RESTARTED':
        handled = this.receiveRestarted(
          envelope as VisualNovelEnvelopeFor<'RESTARTED'>
        )
        break
      case 'SESSION_ENDED':
        handled = this.receiveSessionEnded(
          envelope as VisualNovelEnvelopeFor<'SESSION_ENDED'>
        )
        break
      case 'CONTROL_CLAIMED':
        handled = this.receiveControlClaimed(
          envelope as VisualNovelEnvelopeFor<'CONTROL_CLAIMED'>
        )
        break
      case 'ERROR':
        handled = this.receiveError(envelope as VisualNovelEnvelopeFor<'ERROR'>)
        break
    }

    if (handled) this.rememberAction(envelope.actionId)
  }

  private receiveSessionStarted = (
    envelope: VisualNovelEnvelopeFor<'SESSION_STARTED'>
  ) => {
    const incoming = envelope.payload.state
    if (
      incoming.revision !== 0 ||
      incoming.controllerPeerId !== envelope.senderPeerId
    ) {
      return false
    }

    if (this.state) {
      const decided = this.state.revision > 0
      if (
        decided ||
        this.state.sessionId === incoming.sessionId ||
        compareStartIdentity(incoming, this.state) >= 0
      ) {
        return true
      }
    }

    this.installState(incoming)
    return true
  }

  private receiveStateRequest = (
    envelope: VisualNovelEnvelopeFor<'STATE_REQUEST'>
  ) => {
    if (!this.state || !this.isController()) return false
    if (envelope.sessionId !== null && !sameSubject(this.state, envelope)) {
      return false
    }

    void this.send(
      'STATE_SNAPSHOT',
      {
        requestActionId: envelope.actionId,
        state: toSnapshotState(this.state),
      },
      this.state,
      envelope.senderPeerId
    )
    // Snapshot requests are safe to replay and must be able to retry a failed
    // response send, so they are intentionally not added to the duplicate set.
    return false
  }

  private receiveStateSnapshot = (
    envelope: VisualNovelEnvelopeFor<'STATE_SNAPSHOT'>
  ) => {
    const matchesActiveRequest =
      this.recovery?.actionId === envelope.payload.requestActionId
    const matchesRecentRequest =
      this.lastSnapshotRequestActionId === envelope.payload.requestActionId
    const matchesClaimCorrection =
      this.lastControlClaimActionId === envelope.payload.requestActionId
    if (
      !matchesActiveRequest &&
      !matchesRecentRequest &&
      !matchesClaimCorrection
    ) {
      return false
    }
    const expectedTarget = matchesActiveRequest
      ? this.recovery?.targetPeerId
      : this.lastSnapshotRequestTargetPeerId
    if (
      !matchesClaimCorrection &&
      expectedTarget &&
      envelope.senderPeerId !== expectedTarget
    ) {
      return false
    }

    const incoming = envelope.payload.state
    if (matchesClaimCorrection) {
      if (!this.state) return false
      const sameSession =
        incoming.sessionId === this.state.sessionId &&
        incoming.storyId === this.state.storyId &&
        incoming.storyVersion === this.state.storyVersion
      if (!sameSession) return false
      if (incoming.revision <= this.state.revision) return true
      if (this.connectedPeerIds().includes(incoming.controllerPeerId)) {
        return false
      }
    } else if (incoming.controllerPeerId !== envelope.senderPeerId) {
      return false
    }

    if (this.state) {
      const sameSession =
        incoming.sessionId === this.state.sessionId &&
        incoming.storyId === this.state.storyId &&
        incoming.storyVersion === this.state.storyVersion
      if (sameSession && incoming.revision < this.state.revision) return true
      if (!sameSession && compareStartIdentity(incoming, this.state) >= 0)
        return true
    }

    this.installState(incoming)
    return true
  }

  private receiveAdvanceRequest = (
    envelope: VisualNovelEnvelopeFor<'ADVANCE_REQUEST'>
  ) => {
    if (!this.authorizeRequest(envelope, envelope.payload.expectedRevision)) {
      return false
    }
    return this.commitAdvance()
  }

  private receiveAdvanced = (envelope: VisualNovelEnvelopeFor<'ADVANCED'>) => {
    if (!this.authorizeControllerEvent(envelope) || !this.state) return false
    if (envelope.revision <= this.state.revision) return true
    if (
      envelope.payload.previousRevision !== this.state.revision ||
      envelope.revision !== this.state.revision + 1
    ) {
      this.requestSnapshot('gap', envelope.senderPeerId)
      return false
    }

    const engine = this.engineForState(this.state)
    if (!engine) return false
    try {
      this.installState(engine.advance(this.state))
      return true
    } catch {
      this.requestSnapshot('gap', envelope.senderPeerId)
      return false
    }
  }

  private receiveChoiceRequest = (
    envelope: VisualNovelEnvelopeFor<'CHOICE_REQUEST'>
  ) => {
    if (!this.authorizeRequest(envelope, envelope.payload.expectedRevision)) {
      return false
    }
    return this.commitChoice(envelope.payload.choiceId)
  }

  private receiveChoiceResolved = (
    envelope: VisualNovelEnvelopeFor<'CHOICE_RESOLVED'>
  ) => {
    if (!this.authorizeControllerEvent(envelope) || !this.state) return false
    if (envelope.revision <= this.state.revision) return true
    if (
      envelope.payload.previousRevision !== this.state.revision ||
      envelope.revision !== this.state.revision + 1
    ) {
      this.requestSnapshot('gap', envelope.senderPeerId)
      return false
    }

    const engine = this.engineForState(this.state)
    if (!engine) return false
    try {
      this.installState(engine.choose(this.state, envelope.payload.choiceId))
      return true
    } catch {
      this.requestSnapshot('gap', envelope.senderPeerId)
      return false
    }
  }

  private receiveRestartRequest = (
    envelope: VisualNovelEnvelopeFor<'RESTART_REQUEST'>
  ) => {
    if (!this.authorizeRequest(envelope, envelope.payload.expectedRevision)) {
      return false
    }
    return this.commitRestart()
  }

  private receiveRestarted = (
    envelope: VisualNovelEnvelopeFor<'RESTARTED'>
  ) => {
    if (!this.authorizeControllerEvent(envelope) || !this.state) return false
    if (envelope.revision <= this.state.revision) return true
    if (
      envelope.payload.previousRevision !== this.state.revision ||
      envelope.revision !== this.state.revision + 1
    ) {
      this.requestSnapshot('gap', envelope.senderPeerId)
      return false
    }

    const engine = this.engineForState(this.state)
    if (!engine) return false
    this.installState(engine.restart(this.state))
    return true
  }

  private receiveSessionEnded = (
    envelope: VisualNovelEnvelopeFor<'SESSION_ENDED'>
  ) => {
    if (!this.authorizeControllerEvent(envelope) || !this.state) return false

    this.state = null
    this.phase = 'ended'
    this.error = null
    this.clearRecovery()
    this.clearCommandRequest()
    this.emit()
    return true
  }

  private receiveControlClaimed = (
    envelope: VisualNovelEnvelopeFor<'CONTROL_CLAIMED'>
  ) => {
    if (!this.state) return false
    const incoming = envelope.payload.state
    const previousControllerPeerId = envelope.payload.previousControllerPeerId
    const connected = this.connectedPeerIds()

    if (
      incoming.sessionId !== this.state.sessionId ||
      incoming.storyId !== this.state.storyId ||
      incoming.storyVersion !== this.state.storyVersion ||
      incoming.controllerPeerId !== envelope.senderPeerId ||
      connected.includes(previousControllerPeerId) ||
      this.lowestConnectedPeerId() !== envelope.senderPeerId
    ) {
      return false
    }

    if (incoming.revision <= this.state.revision) {
      void this.send(
        'STATE_SNAPSHOT',
        {
          requestActionId: envelope.actionId,
          state: toSnapshotState(this.state),
        },
        this.state,
        envelope.senderPeerId
      )
      return false
    }

    if (
      this.state.controllerPeerId !== previousControllerPeerId &&
      compareId(envelope.senderPeerId, this.state.controllerPeerId) >= 0
    ) {
      return false
    }

    this.installState(incoming)
    return true
  }

  private receiveError = (envelope: VisualNovelEnvelopeFor<'ERROR'>) => {
    if (envelope.payload.code !== 'REVISION_MISMATCH') return false
    if (this.state?.controllerPeerId !== envelope.senderPeerId) return false
    if (
      envelope.payload.requestActionId &&
      envelope.payload.requestActionId !== this.commandRequest?.actionId
    ) {
      return false
    }
    this.clearCommandRequest()
    this.requestSnapshot('gap', envelope.senderPeerId)
    return true
  }

  private authorizeRequest = (
    envelope: VisualNovelActionEnvelope,
    expectedRevision: number
  ) => {
    if (
      !this.state ||
      !this.isController() ||
      !sameSubject(this.state, envelope)
    ) {
      return false
    }
    if (expectedRevision !== this.state.revision) {
      void this.send(
        'ERROR',
        { code: 'REVISION_MISMATCH', requestActionId: envelope.actionId },
        this.state,
        envelope.senderPeerId
      )
      return false
    }
    return true
  }

  private authorizeControllerEvent = (envelope: VisualNovelActionEnvelope) =>
    Boolean(
      this.state &&
      envelope.senderPeerId === this.state.controllerPeerId &&
      sameSubject(this.state, envelope)
    )

  private commitAdvance = () => {
    if (!this.state || !this.isController()) return false
    const previousRevision = this.state.revision
    const engine = this.engineForState(this.state)
    if (!engine) return false
    try {
      const next = engine.advance(this.state)
      this.installState(next)
      void this.send('ADVANCED', { previousRevision }, next)
      return true
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Story advance failed')
      return false
    }
  }

  private commitChoice = (choiceId: string) => {
    if (!this.state || !this.isController()) return false
    const previousRevision = this.state.revision
    const engine = this.engineForState(this.state)
    if (!engine) return false
    try {
      const next = engine.choose(this.state, choiceId)
      this.installState(next)
      void this.send('CHOICE_RESOLVED', { choiceId, previousRevision }, next)
      return true
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Choice failed')
      return false
    }
  }

  private commitRestart = () => {
    if (!this.state || !this.isController()) return false
    const previousRevision = this.state.revision
    const engine = this.engineForState(this.state)
    if (!engine) return false
    const next = engine.restart(this.state)
    this.installState(next)
    void this.send('RESTARTED', { previousRevision }, next)
    return true
  }

  private requestSnapshot = (
    reason: VisualNovelRecoveryReason,
    targetPeerId?: string
  ) => {
    if (!this.connected) return
    this.clearCommandRequest()
    if (targetPeerId === this.transport.getSelfId()) return
    if (!targetPeerId && this.transport.getPeers().length === 0) {
      if (!this.state) {
        this.phase = 'idle'
        this.error = null
        this.emit()
      }
      return
    }

    this.clearRecovery()
    const envelope = this.envelopeFor(
      'STATE_REQUEST',
      {
        knownRevision: this.state?.revision ?? -1,
        reason,
      },
      this.state
    )
    this.rememberAction(envelope.actionId)
    this.lastSnapshotRequestActionId = envelope.actionId
    this.lastSnapshotRequestTargetPeerId = targetPeerId ?? null
    this.phase = 'syncing'
    this.error = null

    const recovery: RecoveryRequest = {
      actionId: envelope.actionId,
      targetPeerId: targetPeerId ?? null,
      timer: 0,
    }
    recovery.timer = this.dependencies.timers.setTimeout(() => {
      if (this.recovery?.actionId !== recovery.actionId) return
      this.recovery = null
      this.error = 'The latest novella state could not be recovered in time'
      this.phase = this.state ? 'error' : 'idle'
      this.emit()
    }, visualNovelLimits.requestTimeoutMs)
    this.recovery = recovery
    this.emit()

    void this.transport.send(envelope, targetPeerId).catch(error => {
      console.error(error)
      if (this.recovery?.actionId === envelope.actionId) {
        this.clearRecovery()
        this.fail('The state request could not be sent')
      }
    })
  }

  private clearRecovery = () => {
    if (!this.recovery) return
    this.dependencies.timers.clearTimeout(this.recovery.timer)
    this.recovery = null
  }

  private clearCommandRequest = () => {
    if (!this.commandRequest) return
    this.dependencies.timers.clearTimeout(this.commandRequest.timer)
    this.commandRequest = null
  }

  private handlePeerJoin = (peerId: string) => {
    if (!this.state && !this.recovery) {
      this.requestSnapshot('join')
      return
    }
    if (
      this.state &&
      this.phase === 'paused' &&
      peerId === this.state.controllerPeerId
    ) {
      this.phase = 'active'
      this.error = null
    }
    this.emit()
  }

  private handlePeerLeave = (peerId: string) => {
    if (this.state?.controllerPeerId !== peerId) {
      this.emit()
      return
    }

    this.clearRecovery()
    this.clearCommandRequest()
    this.phase = 'paused'
    this.error = null
    this.emit()
  }
}
