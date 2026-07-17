import type { VisualNovelSessionState } from './visualNovel'

export type VisualNovelActionType =
  | 'SESSION_STARTED'
  | 'STATE_REQUEST'
  | 'STATE_SNAPSHOT'
  | 'ADVANCE_REQUEST'
  | 'ADVANCED'
  | 'CHOICE_REQUEST'
  | 'CHOICE_RESOLVED'
  | 'RESTART_REQUEST'
  | 'RESTARTED'
  | 'SESSION_ENDED'
  | 'CONTROL_CLAIMED'
  | 'ERROR'

export type VisualNovelRecoveryReason = 'join' | 'gap' | 'timeout'

export interface VisualNovelActionEnvelope<T = any>
  extends Record<string, any> {
  protocol: 'visual-novel'
  protocolVersion: 1
  actionId: string
  actionType: VisualNovelActionType
  senderPeerId: string
  sessionId: string | null
  storyId: string | null
  storyVersion: string | null
  revision: number
  timestamp: number
  payload: T
}

export type VisualNovelPayloadByAction = {
  SESSION_STARTED: { state: VisualNovelSessionState }
  STATE_REQUEST: {
    knownRevision: number
    reason: VisualNovelRecoveryReason
  }
  STATE_SNAPSHOT: {
    requestActionId: string
    state: VisualNovelSessionState
  }
  ADVANCE_REQUEST: { expectedRevision: number }
  ADVANCED: { previousRevision: number }
  CHOICE_REQUEST: { choiceId: string; expectedRevision: number }
  CHOICE_RESOLVED: { choiceId: string; previousRevision: number }
  RESTART_REQUEST: { expectedRevision: number }
  RESTARTED: { previousRevision: number }
  SESSION_ENDED: { previousRevision: number }
  CONTROL_CLAIMED: {
    previousControllerPeerId: string
    state: VisualNovelSessionState
  }
  ERROR: { code: string; requestActionId?: string }
}

export type VisualNovelEnvelopeFor<T extends VisualNovelActionType> =
  VisualNovelActionEnvelope<VisualNovelPayloadByAction[T]> & { actionType: T }

export type VisualNovelRuntimePhase =
  | 'idle'
  | 'syncing'
  | 'active'
  | 'paused'
  | 'ended'
  | 'error'

export interface VisualNovelRuntimeSnapshot {
  phase: VisualNovelRuntimePhase
  state: VisualNovelSessionState | null
  error: string | null
  isController: boolean
  canClaimControl: boolean
  pendingRequest: boolean
}
