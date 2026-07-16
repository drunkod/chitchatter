# 02 — Data models

> **Revision 5 changes:** `sessionEpoch` added to `VisualNovelSessionState`; new actions `START_PROPOSE`/`START_COMMITTED` (coordinated start, 09); `CONTROLLER_CHANGED` payload gains the frozen `roundId` and `electorate` (10); round/termination bookkeeping types (`StartRound`, `ElectionRound`, `PendingTermination`) defined here so the service and hook docs share one shape.

## `src/models/visualNovel.ts`

```ts
// NOTE: interfaces that travel over the transport extend Record<string, any>
// (Trystero DataPayload compatibility — repository convention).

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
  // Room-monotonic session ordering (01). All cross-session comparisons order
  // by (sessionEpoch, revision) — revision alone can never resurrect an
  // obsolete session (10).
  sessionEpoch: number
  sceneId: string
  dialogueEntryId: string
  variables: Record<string, VisualNovelValue>
  history: VisualNovelHistoryEntry[]
  controllerPeerId: string
  revision: number
  updatedAt: number
}

export interface VisualNovelScope {
  sessionId: string
  storyId: string
  storyVersion: string
}

// Durable local participation, owned as a mutable ref by the sync layer so
// receive callbacks never close over stale React state (rejoin race, 12).
export type VisualNovelParticipation =
  | { kind: 'joined' }
  | { kind: 'left-current-session'; sessionId: string }

export type VisualNovelActionType =
  | 'START_PROPOSE'
  | 'START_COMMITTED'
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
  proof?: string // reserved for post-MVP signed digests (00); stripped in MVP
}

export type VisualNovelPayloadByAction = {
  // ---- coordinated start (09) ----
  // Proposal: targeted at the start coordinator. candidate.revision === 0,
  // candidate.controllerPeerId === sender. Envelope uses bootstrap scope.
  START_PROPOSE: { roundId: string; candidate: VisualNovelSessionState }
  // Commit: broadcast by the coordinator; the ONLY installer of fresh
  // sessions. state.sessionEpoch === latestKnownEpoch + 1.
  START_COMMITTED: { roundId: string; state: VisualNovelSessionState }

  STATE_REQUEST: { knownRevision: number }
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
  // Controller-only story switch at sessionEpoch + 1 (09). Fresh starts use
  // START_COMMITTED instead.
  SESSION_STARTED: { state: VisualNovelSessionState }
  SESSION_ENDED: Record<string, never>
  // Targeted at the FROZEN winner of an open election round (10).
  ELECTION_ADVERTISE: { roundId: string; state: VisualNovelSessionState }
  CONTROL_REQUEST: Record<string, never>
  CONTROL_PASSED: { controllerPeerId: string }
  // Migration announcement: frozen round identity + full adopted snapshot,
  // applied atomically (10).
  CONTROLLER_CHANGED: {
    roundId: string
    departedControllerPeerId: string
    electorate: string[]
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

## Round and termination bookkeeping (sync-internal, not transported)

```ts
// A start round exists at the coordinator while it collects proposals, and
// at proposers while they await the commit (09).
export interface StartRound {
  roundId: string          // coordinator-generated
  coordinatorPeerId: string
  epoch: number            // latestKnownEpoch + 1 at open
  candidates: VisualNovelSessionState[] // at the coordinator
  openedAt: number
}

// An election round freezes its identity at open (10). roundId is derived
// deterministically so all replicas that observed the same departure and
// membership agree without extra messages:
//   roundId = `${sessionEpoch}:${departedControllerPeerId}:${electorate.sort().join('|')}`
export interface ElectionRound {
  roundId: string
  sessionEpoch: number
  departedControllerPeerId: string
  electorate: string[]     // FROZEN at open: [selfId, ...getPeers()] minus departed
  winnerPeerId: string     // FROZEN: electController(electorate)
  openedAt: number
  advertised: VisualNovelSessionState[] // collected at the winner
  applied: { sessionEpoch: number; revision: number; controllerPeerId: string } | null
}

// Termination in flight (11): authority retained until dissemination.
export interface PendingTermination {
  sessionId: string
  sessionEpoch: number
  envelope: EnvelopeFor<'SESSION_ENDED'> // resent verbatim (same actionId)
}
```

## Model invariants enforced elsewhere

| Invariant | Enforced in |
| --- | --- |
| `START_PROPOSE.candidate` / `START_COMMITTED.state`: revision 0; proposer candidate controller == sender; epoch ≥ 1 | structural validator (03), start round (09) |
| `SESSION_STARTED` (switch): controller-only, epoch exactly `current + 1` | matrix (08), 09 |
| Envelope fields === embedded `state.*` (incl. revision) for every state-carrying action | structural validator (03) |
| `CONTROLLER_CHANGED`: `state.controllerPeerId === payload.controllerPeerId === sender`; sender is frozen round winner; adoption ordered by `(sessionEpoch, revision)` | validator (03) + round rules (10) |
| Tombstone/duplicate/epoch pre-dispatch gate on every envelope | dispatcher (12) |
| Engine output within variable count/byte/finiteness limits | engine (05) |
| Effect-reachable variable names ≤ `maxEffectVariables` | story validation (04) |
