# 03 — P2P protocol, synchronization, and controller migration

> **Revision 2 changes:**
>
> 1. `CONTROLLER_CHANGED` is now applicable — replicas previously required the sender to equal the *old* controller, which made migration impossible. New acceptance rule below.
> 2. Bootstrap `STATE_REQUEST`: the envelope factory takes an explicit scope, so a peer with **null** state can request a snapshot (the old design required a full state object, making missing-state recovery dead code).
> 3. Duplicate suppression is commit-based: action IDs are recorded only after successful apply/handling, so retransmits of messages that failed validation or triggered recovery are not swallowed.
> 4. The story-mismatch check moved after the snapshot exception so story switching (new `SESSION_STARTED`) can be applied.
> 5. Election reads transport truth (`peerRoom.getPeers()` + `selfId`), not React state.
> 6. `RESTART_REQUEST` now checks `expectedRevision` like the other requests.
> 7. Controller request handling is serialized through a promise queue.
> 8. `SESSION_STARTED` broadcast is wired (`startSession`), and outgoing snapshots pass through `toSnapshotState`.

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

The resulting action name is `gvn.9` (5 chars) — safely under the limit. Do not add one enum member per novella action. The semantic name is `envelope.actionType`.

## Extend `src/lib/PeerRoom/PeerRoom.ts`

Novella needs its own join/leave subscription without removing chat/media handlers, plus access to the local transport peer ID (verified: nothing in `src/` currently exposes it — Trystero exports `selfId`).

```ts
import { joinRoom, selfId /* … existing imports … */ } from '@trystero-p2p/torrent'

export enum PeerHookType {
  NEW_PEER = 'NEW_PEER',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
  SCREEN = 'SCREEN',
  FILE_SHARE = 'FILE_SHARE',
  VISUAL_NOVEL = 'VISUAL_NOVEL',
}

// Inside PeerRoom:
getSelfId = () => selfId

removePeerJoinHandler = (peerHookType: PeerHookType) => {
  this.peerJoinHandlers.delete(peerHookType)
}

removePeerLeaveHandler = (peerHookType: PeerHookType) => {
  this.peerLeaveHandlers.delete(peerHookType)
}
```

Keep the global flush methods for room teardown. Feature-hook cleanup should use keyed removal.

## `src/services/visualNovel/VisualNovelSyncService.ts`

This service decides whether an envelope is safe to apply. **The `inspect*` methods are pure — they never mutate the seen-set.** Callers invoke `commit(envelope)` only after the action is successfully applied or handled. This prevents a snapshot that fails payload validation (or an event that triggers recovery) from poisoning the duplicate set against a legitimate retransmit.

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

    // Snapshot-class actions may establish or replace a session — including
    // one for a *different* story (story switching). Their payload is fully
    // validated by validateSessionState before application, and applyCanonical
    // enforces the sender rules for snapshots (see below).
    if (snapshotActions.has(envelope.actionType)) {
      return { kind: 'apply' }
    }

    if (!state) {
      return { kind: 'recover', reason: 'missing-state' }
    }
    if (envelope.storyId !== state.storyId ||
        envelope.storyVersion !== state.storyVersion) {
      return { kind: 'reject', reason: 'story-mismatch' }
    }
    if (envelope.sessionId !== state.sessionId) {
      return { kind: 'recover', reason: 'session-mismatch' }
    }
    if (envelope.revision <= state.revision) {
      return { kind: 'ignore', reason: 'stale' }
    }
    if (envelope.revision !== state.revision + 1) {
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
    // STATE_REQUEST is exempt from session matching: a late joiner with no
    // state sends the reserved bootstrap scope and cannot know real IDs.
    if (envelope.actionType !== 'STATE_REQUEST' &&
        (envelope.storyId !== state.storyId ||
         envelope.storyVersion !== state.storyVersion ||
         envelope.sessionId !== state.sessionId)) {
      return { kind: 'reject', reason: 'session-mismatch' }
    }
    if (this.seen.has(envelope.actionId)) {
      return { kind: 'ignore', reason: 'duplicate' }
    }
    return { kind: 'apply' }
  }

  // Record an action ID only after it was successfully applied or handled.
  commit(envelope: VisualNovelActionEnvelope) {
    this.seen.set(envelope.actionId, envelope.timestamp)
    while (this.seen.size > visualNovelLimits.maxSeenActionIds) {
      const oldest = this.seen.keys().next().value
      if (!oldest) break
      this.seen.delete(oldest)
    }
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

  // Migration acceptance: replicas accept CONTROLLER_CHANGED from the NEW
  // controller when the sender matches the announced controller, the old
  // controller is gone from the transport, and the revision is exactly next.
  isAcceptableControllerChange(
    envelope: VisualNovelActionEnvelope,
    state: VisualNovelSessionState,
    transportPeerId: string,
    connectedTransportPeerIds: string[]
  ): boolean {
    const announced = (envelope.payload as { controllerPeerId?: unknown })
      .controllerPeerId
    return (
      envelope.actionType === 'CONTROLLER_CHANGED' &&
      typeof announced === 'string' &&
      announced === envelope.senderPeerId &&
      envelope.senderPeerId === transportPeerId &&
      !connectedTransportPeerIds.includes(state.controllerPeerId) &&
      envelope.revision === state.revision + 1
    )
  }
}
```

Competing `CONTROLLER_CHANGED` announcements resolve by highest revision, then lowest peer ID (`chooseElectionState` ordering).

## Envelope factory

Create `src/services/visualNovel/createVisualNovelEnvelope.ts`. It takes an explicit **scope** (not a full state) so bootstrap requests are possible with null local state:

```ts
import { visualNovelProtocolVersion } from 'config/visualNovel'
import type {
  EnvelopeFor,
  VisualNovelActionType,
  VisualNovelPayloadByAction,
  VisualNovelScope,
} from 'models/visualNovel'

export interface EnvelopeDependencies {
  actionId: () => string
  now: () => number
}

export const createVisualNovelEnvelope = <T extends VisualNovelActionType>(
  actionType: T,
  payload: VisualNovelPayloadByAction[T],
  scope: VisualNovelScope,
  senderPeerId: string,
  revision: number,
  dependencies: EnvelopeDependencies
): EnvelopeFor<T> => ({
  protocol: 'visual-novel',
  protocolVersion: visualNovelProtocolVersion,
  actionId: dependencies.actionId(),
  actionType,
  sessionId: scope.sessionId,
  storyId: scope.storyId,
  storyVersion: scope.storyVersion,
  senderPeerId,
  revision,
  timestamp: dependencies.now(),
  payload,
})
```

A session state satisfies `VisualNovelScope` structurally, so existing call sites can pass `state` directly; bootstrap callers pass `visualNovelBootstrapScope`.

## `src/hooks/useVisualNovelSync.ts`

This full skeleton shows transport binding, bootstrap and targeted requests, canonical broadcasts, late join, recovery, and migration. Factor handlers further as tests grow.

```ts
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { v4 as uuid } from 'uuid'
import type { MessageContext } from 'trystero'

import { usePeerAction } from 'hooks/usePeerAction'
import { ActionNamespace, PeerHookType, PeerRoom } from 'lib/PeerRoom'
import { PeerAction } from 'models/network'
import { visualNovelBootstrapScope } from 'config/visualNovel'
import type {
  VisualNovelActionEnvelope,
  VisualNovelManifest,
  VisualNovelSessionState,
} from 'models/visualNovel'
import {
  VisualNovelEngine,
  VisualNovelSyncService,
  toSnapshotState,
  validateEnvelope,
  validateSessionState,
  createVisualNovelEnvelope,
} from 'services/visualNovel'

interface Options {
  peerRoom: PeerRoom
  selfPeerId: string // peerRoom.getSelfId()
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

  // Serialize controller-side request handling so two concurrent requests
  // cannot both apply against the same revision.
  const requestQueueRef = useRef<Promise<void>>(Promise.resolve())
  const enqueue = (work: () => Promise<void>) => {
    requestQueueRef.current = requestQueueRef.current.then(work, work)
    return requestQueueRef.current
  }

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
    const snapshot = toSnapshotState(current)
    const envelope = createVisualNovelEnvelope(
      'STATE_SNAPSHOT',
      { state: snapshot },
      current,
      selfPeerId,
      current.revision,
      dependencies
    )
    await sendRef.current?.(envelope, { target })
  }, [selfPeerId])

  // Works with null local state via the bootstrap scope. Without a known
  // controller it broadcasts; the (sole) controller answers, others ignore
  // it via inspectRequest's not-controller rejection.
  const requestSnapshot = useCallback(async (
    current: VisualNovelSessionState | null,
    target?: string
  ) => {
    const envelope = createVisualNovelEnvelope(
      'STATE_REQUEST',
      { knownRevision: current?.revision ?? 0 },
      current ?? visualNovelBootstrapScope,
      selfPeerId,
      current?.revision ?? 0,
      dependencies
    )
    await sendRef.current?.(envelope, target ? { target } : undefined)
  }, [selfPeerId])

  const broadcastCanonical = useCallback(async (
    actionType: 'ADVANCED' | 'CHOICE_RESOLVED' | 'RESTARTED' |
      'CONTROLLER_CHANGED' | 'SESSION_STARTED',
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

  const startSession = useCallback(async (initial: VisualNovelSessionState) => {
    await broadcastCanonical('SESSION_STARTED',
      { state: toSnapshotState(initial) }, initial)
  }, [broadcastCanonical])

  const handleRequest = useCallback((
    envelope: VisualNovelActionEnvelope,
    context: MessageContext
  ) => enqueue(async () => {
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
        // Same stale-request guard as advance/choice: a restart computed
        // against an old revision must not wipe newer progress.
        if ((envelope.payload as { expectedRevision: number }).expectedRevision !== current.revision) {
          await sendSnapshot(current, context.peerId)
          return
        }
        const next = currentEngine.restart(current)
        await broadcastCanonical('RESTARTED', { state: toSnapshotState(next) }, next)
      }
      sync.commit(envelope) // only after successful handling
    } catch (error) {
      onProtocolError(error instanceof Error ? error.message : 'Transition failed')
    }
  }), [broadcastCanonical, onProtocolError, selfPeerId, sendSnapshot, sync])

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
      if (!validated.ok) return // NOT committed — a valid retransmit may follow

      const next = validated.value
      const sameSession = current && next.sessionId === current.sessionId
      // Same session: accept only monotonically newer snapshots. Different
      // session (story switch / fresh start): accept only from the current
      // controller — or from anyone if we have no state at all.
      const acceptable = !current ||
        (sameSession
          ? next.revision >= current.revision
          : context.peerId === current.controllerPeerId)
      if (!acceptable) return
      setState(next)
      sync.commit(envelope)
      return
    }

    if (!current) return

    if (envelope.actionType === 'CONTROLLER_CHANGED') {
      const connected = peerRoom.getPeers()
      if (!sync.isAcceptableControllerChange(envelope, current, context.peerId, connected)) {
        return
      }
      setState({
        ...current,
        controllerPeerId: envelope.senderPeerId,
        revision: envelope.revision,
        updatedAt: envelope.timestamp,
      })
      sync.commit(envelope)
      return
    }

    // ADVANCED / CHOICE_RESOLVED: only the current controller may progress
    // the story.
    if (context.peerId !== current.controllerPeerId) return
    const payload = envelope.payload as Record<string, unknown>
    const next: VisualNovelSessionState = {
      ...current,
      sceneId: String(payload.sceneId ?? current.sceneId),
      dialogueEntryId: String(payload.dialogueEntryId ?? current.dialogueEntryId),
      variables: (payload.variables as VisualNovelSessionState['variables']) ?? current.variables,
      revision: envelope.revision,
      updatedAt: envelope.timestamp,
    }
    setState(next)
    sync.commit(envelope)
  }, [peerRoom, requestSnapshot, setState, sync])

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

  const requestRestart = useCallback(async () => {
    const current = stateRef.current
    if (!current) return
    if (current.controllerPeerId === selfPeerId) {
      const next = engineRef.current?.restart(current)
      if (next) await broadcastCanonical('RESTARTED',
        { state: toSnapshotState(next) }, next)
      return
    }
    const envelope = createVisualNovelEnvelope('RESTART_REQUEST',
      { expectedRevision: current.revision }, current, selfPeerId,
      current.revision, dependencies)
    await sendEnvelope(envelope, { target: current.controllerPeerId })
  }, [broadcastCanonical, selfPeerId, sendEnvelope])

  useEffect(() => {
    peerRoom.onPeerJoin(PeerHookType.VISUAL_NOVEL, peerId => {
      const current = stateRef.current
      if (!current) return
      if (current.controllerPeerId === selfPeerId) void sendSnapshot(current, peerId)
    })

    peerRoom.onPeerLeave(PeerHookType.VISUAL_NOVEL, peerId => {
      const current = stateRef.current
      if (!current || peerId !== current.controllerPeerId) return
      // Transport truth, not React state: peerRoom.getPeers() already
      // excludes the departed peer, and selfId is not in getPeers().
      const nextController = sync.electController([
        selfPeerId,
        ...peerRoom.getPeers().filter(id => id !== peerId),
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
  }, [broadcastCanonical, peerRoom, selfPeerId, sendSnapshot, sync])

  // Late join with no state: ask the room for the current session once the
  // action is bound. Harmless if no story is running (no controller answers).
  useEffect(() => {
    if (stateRef.current) return
    void requestSnapshot(null)
  }, [requestSnapshot])

  return { requestAdvance, requestChoice, requestRestart, startSession }
}
```

## Required refinements before merge

- Make canonical event application derive/validate the exact next state with the engine (replay `ADVANCED`/`CHOICE_RESOLVED` through `engine.advance`/`engine.choose` and compare) rather than trusting cast payload fields; the skeleton above still trusts the controller for scene/dialogue/variables.
- Implement `CONTROL_REQUEST`, explicit `CONTROL_PASSED`, restart confirmation UI (04), and targeted `ERROR` responses.
- During election, exchange revision advertisements/snapshots before finalizing when peers may hold different revisions; `chooseElectionState` picks the winner.

## Protocol flows

### Choice request

```text
participant → controller: CHOICE_REQUEST(expectedRevision, choiceId)
controller: validate identity/session/revision/choice; engine.choose (serialized queue)
controller → all: CHOICE_RESOLVED(revision + 1, canonical delta)
all peers: validate controller and exact next revision; apply; commit actionId
```

### Late join (bootstrap)

```text
new peer (state = null) → all: STATE_REQUEST(bootstrap scope, knownRevision 0)
controller (only peer that passes inspectRequest) → new peer: STATE_SNAPSHOT(truncated state)
new peer: validate full snapshot; apply; commit
(controller additionally pushes a snapshot on onPeerJoin — both paths converge)
```

### Session start with peers already present

```text
controller: engine.start → local state revision 0
controller → all: SESSION_STARTED(truncated state)
peers with null state: validate; apply; commit
```

### Revision gap

```text
replica has n; receives n + 2
replica ignores event (actionId NOT committed)
replica → controller: STATE_REQUEST(n)
controller → replica: STATE_SNAPSHOT(current)
```

### Controller disconnect

```text
all remaining peers detect the same leave
each computes smallest peer ID from transport truth (getPeers() + selfId)
winner broadcasts CONTROLLER_CHANGED(revision + 1)
replicas accept because: sender == announced controller, old controller
  absent from transport, revision exactly next
competing announcements resolve by revision, then peer ID
```
