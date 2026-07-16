# 02 — Data models

> **Revision 4 changes:** `CONTROLLER_CHANGED` now carries the **full adopted snapshot plus the election-round key** (`departedControllerPeerId`) so controller migration transfers state atomically instead of leaving replicas at a fake revision with stale content. New `Participation` type makes leaving a session durable. Payload map updated accordingly.

## `src/models/visualNovel.ts`

```ts
// NOTE: interfaces that travel over the transport extend Record<string, any>.
// Trystero's DataPayload is JSON-value based and is NOT satisfied by
// Record<string, unknown>. This matches the existing repository convention
// (UnsentMessage, TypingStatus, UserMetadata).

export type VisualNovelValue = string | number | boolean

export interface VisualNovelCharacterPlacement {
  characterId: string
  sprite: string
  position: 'left' | 'center' | 'right'
  expression?: string
}

export interface VisualNovelCondition {
  variable: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  value: VisualNovelValue
}

export type VisualNovelEffect =
  | { type: 'set'; variable: string; value: VisualNovelValue }
  | { type: 'increment'; variable: string; amount: number }

export interface VisualNovelChoice {
  id: string
  label: string
  nextSceneId: string
  conditions?: VisualNovelCondition[]
  effects?: VisualNovelEffect[]
}

export interface VisualNovelTransition {
  sceneId?: string
  dialogueEntryId?: string
}

export interface VisualNovelDialogueEntry {
  id: string
  speaker?: string
  text: string
  portrait?: string
  characterChanges?: VisualNovelCharacterPlacement[]
  soundEffect?: string
  next?: VisualNovelTransition
  choices?: VisualNovelChoice[]
}

export interface VisualNovelScene {
  id: string
  background?: string
  music?: string
  characters?: VisualNovelCharacterPlacement[]
  dialogue: VisualNovelDialogueEntry[]
}

export interface VisualNovelManifest {
  id: string
  version: string
  title: string
  description?: string
  startSceneId: string
  assets?: Record<string, string>
  scenes: Record<string, VisualNovelScene>
}

export interface VisualNovelHistoryEntry {
  revision: number
  sceneId: string
  dialogueEntryId: string
  choiceId?: string
}

export interface VisualNovelSessionState extends Record<string, any> {
  protocolVersion: 1
  storyId: string
  storyVersion: string
  sessionId: string
  sceneId: string
  dialogueEntryId: string
  variables: Record<string, VisualNovelValue>
  history: VisualNovelHistoryEntry[]
  controllerPeerId: string
  revision: number
  updatedAt: number
}

// Identifiers shared by every envelope; separated from full state so that
// envelopes (e.g. bootstrap STATE_REQUEST) can be built without one.
export interface VisualNovelScope {
  sessionId: string
  storyId: string
  storyVersion: string
}

// Durable local participation. 'left-current-session' survives incoming
// envelopes: a participant who left stays left until explicit rejoin (09).
export type VisualNovelParticipation =
  | { kind: 'joined' }
  | { kind: 'left-current-session'; sessionId: string }

export type VisualNovelActionType =
  | 'STATE_REQUEST'
  | 'STATE_SNAPSHOT'
  | 'ADVANCE_REQUEST'
  | 'ADVANCED'
  | 'CHOICE_REQUEST'
  | 'CHOICE_RESOLVED'
  | 'SESSION_STARTED'
  | 'SESSION_ENDED'
  | 'ELECTION_ADVERTISE'
  | 'CONTROL_REQUEST'
  | 'CONTROL_PASSED'
  | 'CONTROLLER_CHANGED'
  | 'RESTART_REQUEST'
  | 'RESTARTED'
  | 'ERROR'

export interface VisualNovelActionEnvelope<T = any>
  extends Record<string, any> {
  protocol: 'visual-novel'
  protocolVersion: 1
  actionId: string
  actionType: VisualNovelActionType
  sessionId: string
  storyId: string
  storyVersion: string
  senderPeerId: string
  revision: number
  timestamp: number
  payload: T
  // Reserved for the post-MVP signed-digest hardening path (00). Absent in
  // MVP traffic; validators must tolerate and strip unknown values here.
  proof?: string
}

export type VisualNovelPayloadByAction = {
  STATE_REQUEST: { knownRevision: number }
  // requestActionId echoes the STATE_REQUEST being answered so a null-state
  // peer can tell a solicited response from unsolicited data. (Provenance of
  // the responder is a crash-fault-model concession — see 00.)
  STATE_SNAPSHOT: { state: VisualNovelSessionState; requestActionId?: string }
  ADVANCE_REQUEST: { expectedRevision: number }
  ADVANCED: { sceneId: string; dialogueEntryId: string }
  CHOICE_REQUEST: { choiceId: string; expectedRevision: number }
  CHOICE_RESOLVED: {
    choiceId: string
    sceneId: string
    dialogueEntryId: string
    variables: Record<string, VisualNovelValue>
  }
  SESSION_STARTED: { state: VisualNovelSessionState }
  SESSION_ENDED: Record<string, never>
  // Targeted at the locally computed election winner during an open round.
  ELECTION_ADVERTISE: { state: VisualNovelSessionState }
  CONTROL_REQUEST: Record<string, never>
  CONTROL_PASSED: { controllerPeerId: string }
  // Migration announcement. Carries the ROUND KEY and the FULL ADOPTED
  // SNAPSHOT so replicas apply controller + content atomically; a bare
  // controller/revision jump with stale scene/variables is impossible.
  CONTROLLER_CHANGED: {
    departedControllerPeerId: string
    controllerPeerId: string
    state: VisualNovelSessionState
  }
  RESTART_REQUEST: { expectedRevision: number }
  RESTARTED: { state: VisualNovelSessionState }
  ERROR: { code: string; requestActionId?: string }
}

export type EnvelopeFor<T extends VisualNovelActionType> =
  VisualNovelActionEnvelope<VisualNovelPayloadByAction[T]> & {
    actionType: T
  }
```

## Model invariants enforced elsewhere

| Invariant | Enforced in |
| --- | --- |
| `SESSION_STARTED.state.revision === 0` and `state.controllerPeerId === senderPeerId` | structural validator (03) |
| Envelope `sessionId/storyId/storyVersion/revision` === embedded `state.*` for every state-carrying action | structural validator (03) |
| `CONTROLLER_CHANGED.state.controllerPeerId === payload.controllerPeerId === senderPeerId` | structural validator (03) |
| `state.sceneId`/`dialogueEntryId`/history entries exist in the loaded story; history revisions ordered | semantic validator (04) |
| Aggregate `variables`/`history` byte budgets | structural validator (03), limits (01) |
| Who may send what, when | authorization matrix (08) |
