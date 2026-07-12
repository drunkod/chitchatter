# 03 — P2P protocol, synchronization, and controller migration

Novella uses the room's existing `PeerRoom`. It does not call `joinRoom` again. One short Trystero action carries all semantic novella messages in a versioned envelope.

## Extend `src/models/network.ts`

```ts
// NOTE: Action names are limited to 12 characters, otherwise Trystero breaks.
export enum PeerAction {
  MESSAGE = 0,
  MEDIA_MESSAGE,
  MESSAGE_TRANSCRIPT,
  PEER_METADATA,
  AUDIO_CHANGE,
  VIDEO_CHANGE,
  SCREEN_SHARE,
  FILE_OFFER,
  TYPING_STATUS_CHANGE,
  VISUAL_NOVEL,
}
```

Do not add one enum member per novella action. The semantic name is `envelope.actionType`.

## Add keyed lifecycle cleanup to `PeerRoom`

Novella needs its own join/leave subscription without removing chat/media handlers. Extend `PeerHookType` and add deletion methods in `src/lib/PeerRoom/PeerRoom.ts`:

```ts
export enum PeerHookType {
  NEW_PEER = 'NEW_PEER',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
  SCREEN = 'SCREEN',
  FILE_SHARE = 'FILE_SHARE',
  VISUAL_NOVEL = 'VISUAL_NOVEL',
}

// Inside PeerRoom:
removePeerJoinHandler = (peerHookType: PeerHookType) => {
  this.peerJoinHandlers.delete(peerHookType)
}

removePeerLeaveHandler = (peerHookType: PeerHookType) => {
  this.peerLeaveHandlers.delete(peerHookType)
}
```

Keep the global flush methods for room teardown. Feature-hook cleanup should use keyed removal.

## `src/services/visualNovel/VisualNovelSyncService.ts`

This pure service decides whether a canonical envelope is safe to apply. Requests are inspected separately because multiple requests may reference the current revision without themselves being canonical transitions.

```ts
import { visualNovelLimits } from 'config/visualNovel'
import type {
  VisualNovelActionEnvelope,
  VisualNovelSessionState,
} from 'models/visualNovel'

export type CanonicalDecision =
  | { kind: 'apply' }
  | { kind: 'ignore'; reason: 'duplicate' | 'stale' }
  | { kind: 'recover'; reason: 'missing-state' | 'session-mismatch' | 'revision-gap' }
  | { kind: 'reject'; reason: string }

const snapshotActions = new Set(['STATE_SNAPSHOT', 'SESSION_STARTED', 'RESTARTED'])

export class VisualNovelSyncService {
  private readonly seen = new Map<string, number>()

  inspectCanonical(
    envelope: VisualNovelActionEnvelope,
    state: VisualNovelSessionState | null,
    transportPeerId: string
  ): CanonicalDecision {
    if (envelope.senderPeerId !== transportPeerId) {
      return { kind: 'reject', reason: 'sender-mismatch' }
    }
    if (this.seen.has(envelope.actionId)) {
      return { kind: 'ignore', reason: 'duplicate' }
    }
    this.remember(envelope.actionId, envelope.timestamp)

    if (!state) {
      return snapshotActions.has(envelope.actionType)
        ? { kind: 'apply' }
        : { kind: 'recover', reason: 'missing-state' }
    }
    if (envelope.storyId !== state.storyId ||
        envelope.storyVersion !== state.storyVersion) {
      return { kind: 'reject', reason: 'story-mismatch' }
    }
    if (envelope.sessionId !== state.sessionId) {
      return snapshotActions.has(envelope.actionType)
        ? { kind: 'apply' }
        : { kind: 'recover', reason: 'session-mismatch' }
    }
    if (envelope.revision <= state.revision) {
      return { kind: 'ignore', reason: 'stale' }
    }
    if (!snapshotActions.has(envelope.actionType) &&
        envelope.revision !== state.revision + 1) {
      return { kind: 'recover', reason: 'revision-gap' }
    }
    return { kind: 'apply' }
  }

  inspectRequest(
    envelope: VisualNovelActionEnvelope,
    state: VisualNovelSessionState,
    transportPeerId: string,
    selfPeerId: string
  ): CanonicalDecision {
    if (envelope.senderPeerId !== transportPeerId) {
      return { kind: 'reject', reason: 'sender-mismatch' }
    }
    if (state.controllerPeerId !== selfPeerId) {
      return { kind: 'reject', reason: 'not-controller' }
    }
    if (envelope.storyId !== state.storyId ||
        envelope.storyVersion !== state.storyVersion ||
        envelope.sessionId !== state.sessionId) {
      return { kind: 'reject', reason: 'session-mismatch' }
    }
    if (this.seen.has(envelope.actionId)) {
      return { kind: 'ignore', reason: 'duplicate' }
    }
    this.remember(envelope.actionId, envelope.timestamp)
    return { kind: 'apply' }
  }

  electController(peerIds: string[]): string {
    const unique = [...new Set(peerIds)].sort((a, b) => a.localeCompare(b))
    if (!unique[0]) throw new Error('Cannot elect a controller without peers')
    return unique[0]
  }

  chooseElectionState(states: VisualNovelSessionState[]): VisualNovelSessionState {
    const candidates = [...states].sort((a, b) =>
      b.revision - a.revision || a.controllerPeerId.localeCompare(b.controllerPeerId)
    )
    if (!candidates[0]) throw new Error('No election state available')
    return candidates[0]
  }

  private remember(actionId: string, timestamp: number) {
    this.seen.set(actionId, timestamp)
    while (this.seen.size > visualNovelLimits.maxSeenActionIds) {
      const oldest = this.seen.keys().next().value
      if (!oldest) break
      this.seen.delete(oldest)
    }
  }
}
```

## Envelope factory

Create `src/services/visualNovel/createVisualNovelEnvelope.ts`:

```ts
import { visualNovelProtocolVersion } from 'config/visualNovel'
import type {
  EnvelopeFor,
  VisualNovelActionType,
  VisualNovelPayloadByAction,
  VisualNovelSessionState,
} from 'models/visualNovel'

export interface EnvelopeDependencies {
  actionId: () => string
  now: () => number
}

export const createVisualNovelEnvelope = <T extends VisualNovelActionType>(
  actionType: T,
  payload: VisualNovelPayloadByAction[T],
  state: VisualNovelSessionState,
  senderPeerId: string,
  revision: number,
  dependencies: EnvelopeDependencies
): EnvelopeFor<T> => ({
  protocol: 'visual-novel',
  protocolVersion: visualNovelProtocolVersion,
  actionId: dependencies.actionId(),
  actionType,
  sessionId: state.sessionId,
  storyId: state.storyId,
  storyVersion: state.storyVersion,
  senderPeerId,
  revision,
  timestamp: dependencies.now(),
  payload,
})
```

## `src/hooks/useVisualNovelSync.ts`

This full skeleton shows transport binding, targeted requests, canonical broadcasts, late join, recovery, and migration. Factor handlers further as tests grow.

```ts
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { v4 as uuid } from 'uuid'
import type { MessageContext } from 'trystero'

import { usePeerAction } from 'hooks/usePeerAction'
import { ActionNamespace, PeerHookType, PeerRoom } from 'lib/PeerRoom'
import { PeerAction } from 'models/network'
import type {
  VisualNovelActionEnvelope,
  VisualNovelManifest,
  VisualNovelSessionState,
} from 'models/visualNovel'
import {
  VisualNovelEngine,
  VisualNovelSyncService,
  validateEnvelope,
  validateSessionState,
} from 'services/visualNovel'
import { createVisualNovelEnvelope } from 'services/visualNovel/createVisualNovelEnvelope'

interface Options {
  peerRoom: PeerRoom
  selfPeerId: string
  connectedPeerIds: string[]
  story: VisualNovelManifest | null
  state: VisualNovelSessionState | null
  setState: (state: VisualNovelSessionState) => void
  onProtocolError: (message: string) => void
}

const namespace = `${ActionNamespace.GROUP}vn`
const dependencies = { actionId: uuid, now: Date.now }

export const useVisualNovelSync = ({
  peerRoom,
  selfPeerId,
  connectedPeerIds,
  story,
  state,
  setState,
  onProtocolError,
}: Options) => {
  const stateRef = useRef(state)
  stateRef.current = state
  const storyRef = useRef(story)
  storyRef.current = story
  const sync = useMemo(() => new VisualNovelSyncService(), [])

  const engine = useMemo(
    () => story ? new VisualNovelEngine(story, { now: Date.now }) : null,
    [story]
  )
  const engineRef = useRef(engine)
  engineRef.current = engine

  const sendRef = useRef<((
    envelope: VisualNovelActionEnvelope,
    options?: { target?: string | string[] }
  ) => Promise<unknown>) | null>(null)

  const sendSnapshot = useCallback(async (
    current: VisualNovelSessionState,
    target: string
  ) => {
    const envelope = createVisualNovelEnvelope(
      'STATE_SNAPSHOT',
      { state: current },
      current,
      selfPeerId,
      current.revision,
      dependencies
    )
    await sendRef.current?.(envelope, { target })
  }, [selfPeerId])

  const requestSnapshot = useCallback(async (
    current: VisualNovelSessionState | null,
    target?: string
  ) => {
    if (!current || !target) return
    const envelope = createVisualNovelEnvelope(
      'STATE_REQUEST',
      { knownRevision: current.revision },
      current,
      selfPeerId,
      current.revision,
      dependencies
    )
    await sendRef.current?.(envelope, { target })
  }, [selfPeerId])

  const broadcastCanonical = useCallback(async (
    actionType: 'ADVANCED' | 'CHOICE_RESOLVED' | 'RESTARTED' | 'CONTROLLER_CHANGED',
    payload: Record<string, unknown>,
    next: VisualNovelSessionState
  ) => {
    const envelope = createVisualNovelEnvelope(
      actionType,
      payload as never,
      next,
      selfPeerId,
      next.revision,
      dependencies
    )
    setState(next)
    await sendRef.current?.(envelope)
  }, [selfPeerId, setState])

  const handleRequest = useCallback(async (
    envelope: VisualNovelActionEnvelope,
    context: MessageContext
  ) => {
    const current = stateRef.current
    const currentEngine = engineRef.current
    if (!current || !currentEngine) return
    const decision = sync.inspectRequest(envelope, current, context.peerId, selfPeerId)
    if (decision.kind !== 'apply') return

    try {
      if (envelope.actionType === 'STATE_REQUEST') {
        await sendSnapshot(current, context.peerId)
      } else if (envelope.actionType === 'ADVANCE_REQUEST') {
        if ((envelope.payload as { expectedRevision: number }).expectedRevision !== current.revision) {
          await sendSnapshot(current, context.peerId)
          return
        }
        const next = currentEngine.advance(current)
        await broadcastCanonical('ADVANCED', {
          sceneId: next.sceneId,
          dialogueEntryId: next.dialogueEntryId,
        }, next)
      } else if (envelope.actionType === 'CHOICE_REQUEST') {
        const payload = envelope.payload as { choiceId: string; expectedRevision: number }
        if (payload.expectedRevision !== current.revision) {
          await sendSnapshot(current, context.peerId)
          return
        }
        const next = currentEngine.choose(current, payload.choiceId)
        await broadcastCanonical('CHOICE_RESOLVED', {
          choiceId: payload.choiceId,
          sceneId: next.sceneId,
          dialogueEntryId: next.dialogueEntryId,
          variables: next.variables,
        }, next)
      } else if (envelope.actionType === 'RESTART_REQUEST') {
        const next = currentEngine.restart(current)
        await broadcastCanonical('RESTARTED', { state: next }, next)
      }
    } catch (error) {
      onProtocolError(error instanceof Error ? error.message : 'Transition failed')
    }
  }, [broadcastCanonical, onProtocolError, selfPeerId, sendSnapshot, sync])

  const applyCanonical = useCallback(async (
    envelope: VisualNovelActionEnvelope,
    context: MessageContext
  ) => {
    const current = stateRef.current
    const decision = sync.inspectCanonical(envelope, current, context.peerId)
    if (decision.kind === 'ignore' || decision.kind === 'reject') return
    if (decision.kind === 'recover') {
      await requestSnapshot(current, current?.controllerPeerId)
      return
    }

    if (['STATE_SNAPSHOT', 'SESSION_STARTED', 'RESTARTED'].includes(envelope.actionType)) {
      const candidate = (envelope.payload as { state: unknown }).state
      const validated = validateSessionState(candidate)
      if (!validated.ok) return
      if (!current || validated.value.revision >= current.revision) setState(validated.value)
      return
    }

    if (!current || context.peerId !== current.controllerPeerId) return
    const payload = envelope.payload as Record<string, unknown>
    const next: VisualNovelSessionState = {
      ...current,
      sceneId: String(payload.sceneId ?? current.sceneId),
      dialogueEntryId: String(payload.dialogueEntryId ?? current.dialogueEntryId),
      variables: (payload.variables as VisualNovelSessionState['variables']) ?? current.variables,
      controllerPeerId: String(payload.controllerPeerId ?? current.controllerPeerId),
      revision: envelope.revision,
      updatedAt: envelope.timestamp,
    }
    setState(next)
  }, [requestSnapshot, setState, sync])

  const onReceive = useCallback(async (input: unknown, context: MessageContext) => {
    const validated = validateEnvelope(input)
    if (!validated.ok) {
      console.warn('Rejected visual-novel envelope', validated.errors)
      return
    }
    const envelope = validated.value
    if (envelope.senderPeerId !== context.peerId) return
    if (envelope.actionType.endsWith('_REQUEST')) {
      await handleRequest(envelope, context)
    } else {
      await applyCanonical(envelope, context)
    }
  }, [applyCanonical, handleRequest])

  const [sendEnvelope] = usePeerAction<VisualNovelActionEnvelope>({
    namespace,
    peerAction: PeerAction.VISUAL_NOVEL,
    peerRoom,
    onReceive,
  })
  sendRef.current = sendEnvelope

  const requestAdvance = useCallback(async () => {
    const current = stateRef.current
    if (!current) return
    if (current.controllerPeerId === selfPeerId) {
      const next = engineRef.current?.advance(current)
      if (next) await broadcastCanonical('ADVANCED', {
        sceneId: next.sceneId,
        dialogueEntryId: next.dialogueEntryId,
      }, next)
      return
    }
    const envelope = createVisualNovelEnvelope('ADVANCE_REQUEST',
      { expectedRevision: current.revision }, current, selfPeerId,
      current.revision, dependencies)
    await sendEnvelope(envelope, { target: current.controllerPeerId })
  }, [broadcastCanonical, selfPeerId, sendEnvelope])

  const requestChoice = useCallback(async (choiceId: string) => {
    const current = stateRef.current
    if (!current) return
    if (current.controllerPeerId === selfPeerId) {
      const next = engineRef.current?.choose(current, choiceId)
      if (next) await broadcastCanonical('CHOICE_RESOLVED', {
        choiceId,
        sceneId: next.sceneId,
        dialogueEntryId: next.dialogueEntryId,
        variables: next.variables,
      }, next)
      return
    }
    const envelope = createVisualNovelEnvelope('CHOICE_REQUEST',
      { choiceId, expectedRevision: current.revision }, current, selfPeerId,
      current.revision, dependencies)
    await sendEnvelope(envelope, { target: current.controllerPeerId })
  }, [broadcastCanonical, selfPeerId, sendEnvelope])

  useEffect(() => {
    peerRoom.onPeerJoin(PeerHookType.VISUAL_NOVEL, peerId => {
      const current = stateRef.current
      if (!current) return
      if (current.controllerPeerId === selfPeerId) void sendSnapshot(current, peerId)
      else void requestSnapshot(current, current.controllerPeerId)
    })

    peerRoom.onPeerLeave(PeerHookType.VISUAL_NOVEL, peerId => {
      const current = stateRef.current
      if (!current || peerId !== current.controllerPeerId) return
      const nextController = sync.electController([
        selfPeerId,
        ...connectedPeerIds.filter(id => id !== peerId),
      ])
      if (nextController === selfPeerId) {
        const next = engineRef.current?.changeController(current, nextController)
        if (next) void broadcastCanonical('CONTROLLER_CHANGED',
          { controllerPeerId: nextController }, next)
      }
    })

    return () => {
      peerRoom.removePeerJoinHandler(PeerHookType.VISUAL_NOVEL)
      peerRoom.removePeerLeaveHandler(PeerHookType.VISUAL_NOVEL)
    }
  }, [broadcastCanonical, connectedPeerIds, peerRoom, requestSnapshot,
    selfPeerId, sendSnapshot, sync])

  return { requestAdvance, requestChoice }
}
```

## Required refinements before merge

- Determine the local Trystero peer ID from an authoritative existing transport API. Do not substitute `userId`.
- Make canonical event application derive/validate the exact next state with the engine or include a validated complete delta; never blindly cast payload fields in production.
- Serialize controller request handling to prevent two concurrent requests from both applying against the same revision. A promise queue or reducer is sufficient.
- Implement `CONTROL_REQUEST`, explicit `CONTROL_PASSED`, restart confirmation, and targeted errors.
- During election, exchange revision advertisements/snapshots before finalizing when peers may hold different revisions.
- Ensure story selection/session start has a bootstrap envelope that can be accepted while local state is null.

## Protocol flows

### Choice request

```text
participant → controller: CHOICE_REQUEST(expectedRevision, choiceId)
controller: validate identity/session/revision/choice; engine.choose
controller → all: CHOICE_RESOLVED(revision + 1, canonical delta)
all peers: validate controller and exact next revision; apply
```

### Late join

```text
new peer → controller: STATE_REQUEST(knownRevision)
controller → new peer only: STATE_SNAPSHOT(full bounded state)
new peer: validate story/version/session/revision; load assets; apply
```

### Revision gap

```text
replica has n; receives n + 2
replica ignores event
replica → controller: STATE_REQUEST(n)
controller → replica: STATE_SNAPSHOT(current)
```

### Controller disconnect

```text
all remaining peers detect the same leave
each calculates smallest connected stable peer ID
candidate gathers highest valid known revision if necessary
candidate → all: CONTROLLER_CHANGED(revision + 1)
replicas resolve competing announcements by revision, then peer ID
```

