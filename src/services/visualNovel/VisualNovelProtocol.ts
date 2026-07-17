import {
  visualNovelLimits,
  visualNovelProtocolVersion,
} from '../../config/visualNovel'
import type {
  VisualNovelManifest,
  VisualNovelSessionState,
} from '../../models/visualNovel'
import type {
  VisualNovelActionEnvelope,
  VisualNovelActionType,
  VisualNovelRecoveryReason,
} from '../../models/visualNovelProtocol'
import { isId, isRecord, isRevision, utf8ByteLength } from './validationUtils'
import {
  validateSessionState,
  type ValidationResult,
} from './VisualNovelValidator'

const actionTypes = new Set<VisualNovelActionType>([
  'SESSION_STARTED',
  'STATE_REQUEST',
  'STATE_SNAPSHOT',
  'ADVANCE_REQUEST',
  'ADVANCED',
  'CHOICE_REQUEST',
  'CHOICE_RESOLVED',
  'RESTART_REQUEST',
  'RESTARTED',
  'SESSION_ENDED',
  'CONTROL_CLAIMED',
  'ERROR',
])

const recoveryReasons = new Set<VisualNovelRecoveryReason>([
  'join',
  'gap',
  'timeout',
])

export type StoryResolver = (
  storyId: string,
  storyVersion: string
) => VisualNovelManifest | null

const isEnvelopeRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= -1

const normalizeState = (
  input: unknown,
  resolveStory: StoryResolver,
  errors: string[]
): VisualNovelSessionState | null => {
  if (!isRecord(input) || !isId(input.storyId) || !isId(input.storyVersion)) {
    errors.push('Envelope state identity is invalid')
    return null
  }

  const story = resolveStory(input.storyId, input.storyVersion)
  if (!story) {
    errors.push('Envelope references an unknown story')
    return null
  }

  const result = validateSessionState(input, story)
  if (!result.ok) {
    errors.push(
      ...result.errors.map(error => `Invalid envelope state: ${error}`)
    )
    return null
  }

  return result.value
}

const requireExpectedRevision = (
  payload: Record<string, unknown>,
  errors: string[]
) => {
  if (!isRevision(payload.expectedRevision)) {
    errors.push('Payload expectedRevision is invalid')
    return null
  }
  return payload.expectedRevision
}

const requirePreviousRevision = (
  payload: Record<string, unknown>,
  errors: string[]
) => {
  if (!isRevision(payload.previousRevision)) {
    errors.push('Payload previousRevision is invalid')
    return null
  }
  return payload.previousRevision
}

export const validateVisualNovelEnvelope = (
  input: unknown,
  contextPeerId: string,
  resolveStory: StoryResolver
): ValidationResult<VisualNovelActionEnvelope> => {
  const warnings: string[] = []
  const errors: string[] = []

  if (utf8ByteLength(input) > visualNovelLimits.maxEnvelopeBytes) {
    return {
      ok: false,
      errors: ['Visual novel envelope is too large'],
      warnings,
    }
  }
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: ['Visual novel envelope must be an object'],
      warnings,
    }
  }

  if (input.protocol !== 'visual-novel') errors.push('Invalid protocol')
  if (input.protocolVersion !== visualNovelProtocolVersion) {
    errors.push('Unsupported visual novel protocol')
  }
  if (!isId(input.actionId)) errors.push('Invalid actionId')
  if (!actionTypes.has(input.actionType as VisualNovelActionType)) {
    errors.push('Invalid actionType')
  }
  if (!isId(input.senderPeerId)) errors.push('Invalid senderPeerId')
  if (input.senderPeerId !== contextPeerId) {
    errors.push('Envelope sender does not match transport peer')
  }
  if (!isEnvelopeRevision(input.revision)) errors.push('Invalid revision')
  if (
    typeof input.timestamp !== 'number' ||
    !Number.isFinite(input.timestamp)
  ) {
    errors.push('Invalid timestamp')
  }

  const identityValues = [input.sessionId, input.storyId, input.storyVersion]
  const hasNullIdentity = identityValues.some(value => value === null)
  const hasStringIdentity = identityValues.some(value => value !== null)
  if (
    (hasNullIdentity && hasStringIdentity) ||
    identityValues.some(value => value !== null && !isId(value))
  ) {
    errors.push('Envelope session identity is invalid')
  }

  if (!isRecord(input.payload)) errors.push('Invalid payload')

  if (
    errors.length ||
    input.protocol !== 'visual-novel' ||
    input.protocolVersion !== visualNovelProtocolVersion ||
    !isId(input.actionId) ||
    !actionTypes.has(input.actionType as VisualNovelActionType) ||
    !isId(input.senderPeerId) ||
    input.senderPeerId !== contextPeerId ||
    !isEnvelopeRevision(input.revision) ||
    typeof input.timestamp !== 'number' ||
    !Number.isFinite(input.timestamp) ||
    !isRecord(input.payload)
  ) {
    return { ok: false, errors, warnings }
  }

  const actionType = input.actionType as VisualNovelActionType
  const payload = input.payload
  const hasCompleteIdentity = identityValues.every(value => value !== null)
  const hasEmptyIdentity = identityValues.every(value => value === null)

  if (actionType !== 'STATE_REQUEST' && !hasCompleteIdentity) {
    errors.push('Only state requests may omit session identity')
  }
  if (actionType !== 'STATE_REQUEST' && input.revision < 0) {
    errors.push('Only bootstrap state requests may use revision -1')
  }
  if (
    actionType === 'STATE_REQUEST' &&
    hasEmptyIdentity &&
    input.revision !== -1
  ) {
    errors.push('Bootstrap state request revision must be -1')
  }

  let normalizedPayload: Record<string, unknown> | null = null

  switch (actionType) {
    case 'SESSION_STARTED': {
      const state = normalizeState(payload.state, resolveStory, errors)
      if (state) normalizedPayload = { state }
      break
    }
    case 'STATE_REQUEST': {
      if (!isEnvelopeRevision(payload.knownRevision)) {
        errors.push('Payload knownRevision is invalid')
      }
      if (!recoveryReasons.has(payload.reason as VisualNovelRecoveryReason)) {
        errors.push('Payload recovery reason is invalid')
      }
      if (!errors.length) {
        normalizedPayload = {
          knownRevision: payload.knownRevision,
          reason: payload.reason,
        }
      }
      break
    }
    case 'STATE_SNAPSHOT': {
      const state = normalizeState(payload.state, resolveStory, errors)
      if (!isId(payload.requestActionId)) {
        errors.push('Payload requestActionId is invalid')
      }
      if (state && isId(payload.requestActionId)) {
        normalizedPayload = { requestActionId: payload.requestActionId, state }
      }
      break
    }
    case 'ADVANCE_REQUEST':
    case 'RESTART_REQUEST': {
      const expectedRevision = requireExpectedRevision(payload, errors)
      if (expectedRevision !== null) normalizedPayload = { expectedRevision }
      break
    }
    case 'ADVANCED':
    case 'RESTARTED':
    case 'SESSION_ENDED': {
      const previousRevision = requirePreviousRevision(payload, errors)
      if (previousRevision !== null) normalizedPayload = { previousRevision }
      break
    }
    case 'CHOICE_REQUEST': {
      const expectedRevision = requireExpectedRevision(payload, errors)
      if (!isId(payload.choiceId)) errors.push('Payload choiceId is invalid')
      if (expectedRevision !== null && isId(payload.choiceId)) {
        normalizedPayload = {
          expectedRevision,
          choiceId: payload.choiceId,
        }
      }
      break
    }
    case 'CHOICE_RESOLVED': {
      const previousRevision = requirePreviousRevision(payload, errors)
      if (!isId(payload.choiceId)) errors.push('Payload choiceId is invalid')
      if (previousRevision !== null && isId(payload.choiceId)) {
        normalizedPayload = {
          previousRevision,
          choiceId: payload.choiceId,
        }
      }
      break
    }
    case 'CONTROL_CLAIMED': {
      const state = normalizeState(payload.state, resolveStory, errors)
      if (!isId(payload.previousControllerPeerId)) {
        errors.push('Payload previousControllerPeerId is invalid')
      }
      if (state && isId(payload.previousControllerPeerId)) {
        normalizedPayload = {
          previousControllerPeerId: payload.previousControllerPeerId,
          state,
        }
      }
      break
    }
    case 'ERROR': {
      if (!isId(payload.code)) errors.push('Payload error code is invalid')
      if (
        payload.requestActionId !== undefined &&
        !isId(payload.requestActionId)
      ) {
        errors.push('Payload requestActionId is invalid')
      }
      if (isId(payload.code)) {
        normalizedPayload = {
          code: payload.code,
          ...(isId(payload.requestActionId)
            ? { requestActionId: payload.requestActionId }
            : {}),
        }
      }
      break
    }
  }

  if (normalizedPayload !== null) {
    switch (actionType) {
      case 'STATE_REQUEST':
        if (input.revision !== normalizedPayload.knownRevision) {
          errors.push('State request revision does not match knownRevision')
        }
        break
      case 'ADVANCE_REQUEST':
      case 'CHOICE_REQUEST':
      case 'RESTART_REQUEST':
        if (input.revision !== normalizedPayload.expectedRevision) {
          errors.push('Request revision does not match expectedRevision')
        }
        break
      case 'ADVANCED':
      case 'CHOICE_RESOLVED':
      case 'RESTARTED':
        if (input.revision !== Number(normalizedPayload.previousRevision) + 1) {
          errors.push('Canonical event revision is not the next revision')
        }
        break
      case 'SESSION_ENDED':
        if (input.revision !== normalizedPayload.previousRevision) {
          errors.push('End event revision does not match previousRevision')
        }
        break
      case 'SESSION_STARTED':
      case 'STATE_SNAPSHOT':
      case 'CONTROL_CLAIMED':
      case 'ERROR':
        break
    }
  }

  if (errors.length || normalizedPayload === null) {
    return { ok: false, errors, warnings }
  }

  const sessionId = input.sessionId === null ? null : String(input.sessionId)
  const storyId = input.storyId === null ? null : String(input.storyId)
  const storyVersion =
    input.storyVersion === null ? null : String(input.storyVersion)

  const state =
    actionType === 'SESSION_STARTED' ||
    actionType === 'STATE_SNAPSHOT' ||
    actionType === 'CONTROL_CLAIMED'
      ? (normalizedPayload.state as VisualNovelSessionState)
      : null

  if (
    state &&
    (sessionId !== state.sessionId ||
      storyId !== state.storyId ||
      storyVersion !== state.storyVersion ||
      input.revision !== state.revision)
  ) {
    return {
      ok: false,
      errors: ['Envelope identity does not match its state'],
      warnings,
    }
  }

  return {
    ok: true,
    value: {
      protocol: 'visual-novel',
      protocolVersion: visualNovelProtocolVersion,
      actionId: input.actionId,
      actionType,
      senderPeerId: input.senderPeerId,
      sessionId,
      storyId,
      storyVersion,
      revision: input.revision,
      timestamp: input.timestamp,
      payload: normalizedPayload,
    },
    warnings,
  }
}
