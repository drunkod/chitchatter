# 03 — P2P protocol, synchronization, and controller migration

> **Revision 3 changes:**
>
> 1. **Election handshake.** Migration is no longer self-nomination: every peer computes the same winner from transport truth; non-winners advertise their state to the winner (`ELECTION_ADVERTISE`); the winner adopts the highest revision (`chooseElectionState`) inside a bounded window, then announces. Replicas accept `CONTROLLER_CHANGED` **only from their locally computed winner**, and a competing announcement with higher revision (or equal revision and lower peer ID) supersedes an already-applied one — no split-brain, no stale-rejection deadlock.
> 2. **Migration-aware recovery targeting.** Gap recovery requests go to the event's sender when the recorded controller is no longer connected, never to the departed controller.
> 3. **Per-action authorization matrix.** Snapshot-class events no longer bypass authorization: `STATE_SNAPSHOT` is controller-only (or a solicited bootstrap response echoing `requestActionId`), `RESTARTED` is controller-only at exactly `revision + 1`, `SESSION_STARTED` must be revision 0 with controller == sender, and story switching on an existing session is controller-only.
> 4. **Exhaustive dispatch.** Both handlers are `switch` statements over the full action union. `ERROR`, `CONTROL_PASSED`, `CONTROL_REQUEST`, and any future action cannot fall through into state mutation; unimplemented actions are rejected and never committed.
> 5. **Engine replay.** Replicas re-derive `ADVANCED`/`CHOICE_RESOLVED` through their own engine and compare; mismatch triggers recovery instead of trusting cast payload fields.
> 6. **Session lifecycle.** Simultaneous revision-0 starts arbitrate deterministically; only the controller may switch stories or end the session (`SESSION_ENDED`); canonical send failures are retried then repaired with a snapshot broadcast.
> 7. **Narrow transport interface.** The sync hook depends on `VisualNovelTransport`, not the concrete `PeerRoom` class (which has private members and is not structurally substitutable in tests).

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

Keep the global flush methods for room teardown. Feature-hook cleanup uses keyed removal. Note `PeerRoom` stores **one** handler per `PeerHookType` — which is exactly why only one novella provider may exist per browser (see 04).

## `src/services/visualNovel/VisualNovelTransport.ts`

The sync hook depends on this interface, not on the `PeerRoom` class. `PeerRoom` satisfies it structurally; tests implement it directly (06).

```ts
import type { DataPayload } from 'trystero'
import type { PeerHookType, PeerRoomAction } from 'lib/PeerRoom'
import type { PeerAction } from 'models/network'

export interface VisualNovelTransport {
  getSelfId: () => string
  getPeers: () => string[]
  makeAction: <T extends DataPayload>(
    peerAction: PeerAction,
    namespace: string
  ) => PeerRoomAction<T>
  onPeerJoin: (type: PeerHookType, handler: (peerId: string) => void) => void
  onPeerLeave: (type: PeerHookType, handler: (peerId: string) => void) => void
  removePeerJoinHandler: (type: PeerHookType) => void
  removePeerLeaveHandler: (type: PeerHookType) => void
}
```

(`usePeerAction` takes a `PeerRoom`; either widen its prop to this interface or call `transport.makeAction` directly in the sync hook — both are acceptable; pick one and keep it consistent.)

## Authorization matrix

`validateEnvelope` (01) proves shape and internal consistency. This matrix is the second gate, evaluated against **current local state** before any mutation. `sender` below always means the transport-verified `context.peerId` (already cross-checked against `senderPeerId`).

| Action | Authorized sender | Preconditions | Effect |
| --- | --- | --- | --- |
| `STATE_REQUEST` | any peer | handled only if self is controller; exempt from session match (bootstrap scope allowed) | targeted `STATE_SNAPSHOT` echoing `requestActionId` |
| `ADVANCE_REQUEST` / `CHOICE_REQUEST` / `RESTART_REQUEST` | any peer | self is controller; session/story match; `expectedRevision === revision` (else snapshot reply) | one engine transition + canonical broadcast |
| `CONTROL_REQUEST` | any peer | self is controller; session match | M3: explicit `CONTROL_PASSED`; until implemented: reject, do not commit |
| `STATE_SNAPSHOT` | current controller; **or** any peer iff local state is null **and** `payload.requestActionId` matches our outstanding bootstrap request | same session: `state.revision >= current.revision`; cross-session: controller only | replace replica |
| `SESSION_STARTED` | with local state: current controller only (story switch). With null state: any peer | `revision === 0`; `state.controllerPeerId === sender` (enforced in validator); collision arbitration below | adopt session |
| `RESTARTED` | current controller only | same session; `revision === current.revision + 1` | replace replica |
| `ADVANCED` / `CHOICE_RESOLVED` | current controller only | same session/story; `revision === current.revision + 1`; **engine replay matches** | apply derived state |
| `SESSION_ENDED` | current controller only | same session | clear replica, return to lobby |
| `CONTROLLER_CHANGED` | locally computed election winner only | previous controller absent from transport; `revision > current.revision`, or equal revision with lower controller ID than a previously applied announcement (supersession) | set controller |
| `CONTROL_PASSED` | current controller only | `revision === current.revision + 1` (M3) | set controller |
| `ELECTION_ADVERTISE` | any remaining peer, targeted | self is the locally computed winner; migration window open | candidate state for `chooseElectionState` |
| `ERROR` | any peer | never mutates session state | surface targeted error to UI |
| anything else / future | — | — | **reject; do not commit** |

**Simultaneous-start arbitration:** two valid revision-0 `SESSION_STARTED` envelopes with different sessions and no prior state can race. Deterministic rule for every peer including both starters: keep the session whose `controllerPeerId` is lexicographically smaller; the losing starter discards its own session and adopts the winner. This is the one case where an existing revision-0 self-started session may be replaced by a non-controller sender.

## `src/services/visualNovel/VisualNovelSyncService.ts`

`inspect*` methods stay pure (no seen-set mutation); `commit(envelope)` records an action ID only after successful application/handling.

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

export class VisualNovelSyncService {
  private readonly seen = new Map<string, number>()

  // Progression events only (ADVANCED / CHOICE_RESOLVED / RESTARTED /
  // CONTROL_PASSED). Snapshot-class and election actions have their own
  // authorization paths in the dispatcher.
  inspectProgression(
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
    if (!state) return { kind: 'recover', reason: 'missing-state' }
    if (transportPeerId !== state.controllerPeerId) {
      return { kind: 'reject', reason: 'not-controller' }
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

  // Snapshot-class authorization per the matrix. outstandingRequestId is the
  // actionId of our unanswered bootstrap/gap STATE_REQUEST, or null.
  authorizeSnapshot(
    envelope: VisualNovelActionEnvelope,
    snapshot: VisualNovelSessionState,
    current: VisualNovelSessionState | null,
    transportPeerId: string,
    outstandingRequestId: string | null
  ): boolean {
    if (envelope.actionType === 'STATE_SNAPSHOT') {
      const solicited = outstandingRequestId !== null &&
        (envelope.payload as { requestActionId?: string }).requestActionId ===
          outstandingRequestId
      if (!current) return solicited
      const fromController = transportPeerId === current.controllerPeerId
      if (snapshot.sessionId === current.sessionId) {
        return (fromController || solicited) &&
          snapshot.revision >= current.revision
      }
      return fromController // cross-session replacement: controller only
    }
    if (envelope.actionType === 'RESTARTED') {
      return current !== null &&
        transportPeerId === current.controllerPeerId &&
        snapshot.sessionId === current.sessionId &&
        snapshot.revision === current.revision + 1
    }
    if (envelope.actionType === 'SESSION_STARTED') {
      // Validator already enforced revision 0 and controller === sender.
      if (!current) return true
      if (transportPeerId === current.controllerPeerId) return true // switch
      // Simultaneous-start arbitration: both sides at revision 0.
      return current.revision === 0 &&
        snapshot.controllerPeerId < current.controllerPeerId
    }
    return false
  }

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

  // CONTROLLER_CHANGED acceptance: only the locally computed winner, with the
  // old controller gone. Supersession (not stale-rejection) resolves races:
  // a better announcement replaces an already-applied one.
  authorizeControllerChange(
    envelope: VisualNovelActionEnvelope,
    state: VisualNovelSessionState,
    transportPeerId: string,
    selfPeerId: string,
    connectedTransportPeerIds: string[],
    lastAppliedChange: { revision: number; controllerPeerId: string } | null
  ): boolean {
    const announced = (envelope.payload as { controllerPeerId?: unknown })
      .controllerPeerId
    if (typeof announced !== 'string') return false
    if (announced !== envelope.senderPeerId ||
        envelope.senderPeerId !== transportPeerId) return false
    if (connectedTransportPeerIds.includes(state.controllerPeerId)) return false
    const expectedWinner = this.electController([
      selfPeerId,
      ...connectedTransportPeerIds,
    ])
    if (announced !== expectedWinner) return false
    if (lastAppliedChange) {
      // Supersession ordering: higher revision wins; equal revision → lower
      // peer ID wins.
      return envelope.revision > lastAppliedChange.revision ||
        (envelope.revision === lastAppliedChange.revision &&
          announced < lastAppliedChange.controllerPeerId)
    }
    return envelope.revision > state.revision
  }
}
```

## Envelope factory

Unchanged from Revision 2 — takes an explicit `VisualNovelScope` (a session state satisfies it structurally; bootstrap callers pass `visualNovelBootstrapScope`). See `createVisualNovelEnvelope.ts` in the file tree.

## `src/hooks/useVisualNovelSync.ts` — structure and rules

The Revision 2 skeleton grew past the point where inline code is clearer than rules. Implement the hook as **two exhaustive `switch` dispatchers** plus lifecycle effects, against `VisualNovelTransport`:

```ts
interface Options {
  transport: VisualNovelTransport
  story: VisualNovelManifest | null
  state: VisualNovelSessionState | null
  setState: (state: VisualNovelSessionState | null) => void
  onProtocolError: (message: string) => void
}
// Returned API:
// { startSession, endSession, requestAdvance, requestChoice, requestRestart }
```

### Receive path

```ts
const onReceive = async (input: unknown, context: MessageContext) => {
  const validated = validateEnvelope(input)
  if (!validated.ok) return warn(validated.errors)
  const envelope = validated.value
  if (envelope.senderPeerId !== context.peerId) return

  switch (envelope.actionType) {
    case 'STATE_REQUEST':
    case 'ADVANCE_REQUEST':
    case 'CHOICE_REQUEST':
    case 'RESTART_REQUEST':
      return enqueue(() => handleRequest(envelope, context)) // controller only
    case 'STATE_SNAPSHOT':
    case 'SESSION_STARTED':
    case 'RESTARTED':
      return applySnapshotClass(envelope, context)
    case 'ADVANCED':
    case 'CHOICE_RESOLVED':
      return applyProgression(envelope, context)
    case 'CONTROLLER_CHANGED':
      return applyControllerChange(envelope, context)
    case 'SESSION_ENDED':
      return applySessionEnded(envelope, context)
    case 'ELECTION_ADVERTISE':
      return collectElectionAdvertisement(envelope, context)
    case 'ERROR':
      return surfaceError(envelope) // never mutates state, never committed
    case 'CONTROL_REQUEST':
    case 'CONTROL_PASSED':
      return rejectUnimplemented(envelope) // M3; reject, do NOT commit
  }
  // No default: the switch is exhaustive over VisualNovelActionType, so a
  // new action type fails check:types until a handler and matrix row exist.
}
```

Handler rules (each ends with `sync.commit(envelope)` **only** on success):

- `handleRequest` — serialized through a promise queue; `inspectRequest`; `expectedRevision` checked for advance/choice/restart (stale → targeted snapshot reply); `STATE_REQUEST` replies with a snapshot echoing `requestActionId: envelope.actionId`.
- `applySnapshotClass` — `validateSessionState` (deep, normalizing); `sync.authorizeSnapshot(envelope, snapshot, current, context.peerId, outstandingRequestId)`; on success `setState(snapshot)`, clear `outstandingRequestId`.
- `applyProgression` — `inspectProgression`; then **engine replay**: derive `next` via `engine.advance(current)` or `engine.choose(current, payload.choiceId)` and require `next.sceneId === payload.sceneId && next.dialogueEntryId === payload.dialogueEntryId` (and variables deep-equal for `CHOICE_RESOLVED`); apply the **derived** state (with `revision`/`updatedAt` from the envelope); replay mismatch → recovery, not application.
- `applyControllerChange` — `sync.authorizeControllerChange(...)` with `transport.getPeers()`; on success set controller, record `lastAppliedChange` for supersession.
- `applySessionEnded` — current controller only, same session; `setState(null)`, return to lobby.
- `collectElectionAdvertisement` — only while self is the computed winner during an open election window; buffer validated states for `chooseElectionState`.
- `rejectUnimplemented` — log, optionally reply with targeted `ERROR('UNSUPPORTED_ACTION')`; **never** commit.

### Recovery targeting

```ts
const recoveryTarget = (current: VisualNovelSessionState | null,
  envelope: VisualNovelActionEnvelope): string => {
  if (!current) return envelope.senderPeerId
  return transport.getPeers().includes(current.controllerPeerId)
    ? current.controllerPeerId
    : envelope.senderPeerId // controller departed (e.g. migration in flight)
}
```

Every `recover` decision sends `STATE_REQUEST` to `recoveryTarget(...)` and records the request's `actionId` as `outstandingRequestId` so the snapshot reply is accepted as solicited.

### Send path (controller)

`broadcastCanonical(actionType, payload, next)`:

1. Apply `next` locally (the controller is the authority — its state may not regress).
2. `await send(envelope)`; on rejection retry `canonicalSendRetries` times.
3. If still failing, broadcast a full `STATE_SNAPSHOT` of current state (retried on the next canonical event if that also fails) and surface a sync warning to the UI. Canonical state is never silently ahead of the room without a pending repair.

### Session lifecycle

- `startSession(initial)` — allowed only when local state is null; broadcasts `SESSION_STARTED` (revision 0). Collisions arbitrate per the matrix.
- Story switch — allowed only when self is the current controller; broadcasts a new `SESSION_STARTED`.
- `endSession()` — controller only; broadcasts `SESSION_ENDED`, then clears local state.
- Controller pressing "leave story" while participants remain must choose: pass control (M3 `CONTROL_PASSED`) or end the session. A participant's leave is purely local (clear replica, stop rendering); no envelope is sent.

### Peer lifecycle effects

- `onPeerJoin(VISUAL_NOVEL)`: controller pushes a snapshot to the joiner (echoing no request — the joiner also sends a bootstrap `STATE_REQUEST`; whichever validated, authorized path lands first wins; the other is stale/duplicate).
- `onPeerLeave(VISUAL_NOVEL)`: if the departed peer is the current controller, open an election window (`electionWindowMs`):
  - compute `winner = electController([selfId, ...transport.getPeers()])`;
  - if self is **not** the winner: send targeted `ELECTION_ADVERTISE { state: toSnapshotState(current) }` to the winner;
  - if self **is** the winner: collect advertisements until the window closes, adopt `chooseElectionState([own, ...advertised])`, apply `engine.changeController(adopted, selfId)`, broadcast `CONTROLLER_CHANGED` at `adopted.revision + 1`, then push snapshots to any peer that advertised a lower revision.
- Cleanup uses `removePeerJoinHandler`/`removePeerLeaveHandler` with `PeerHookType.VISUAL_NOVEL` — never `flush()`.
- On mount with null state: send one bootstrap `STATE_REQUEST` (broadcast; only the controller handles it) and record `outstandingRequestId`.

## Protocol flows

### Choice request

```text
participant → controller: CHOICE_REQUEST(expectedRevision, choiceId)
controller: authorize; engine.choose (serialized queue)
controller: apply locally → all: CHOICE_RESOLVED(revision + 1, delta)
replicas: authorize controller + exact revision; ENGINE REPLAY; apply derived
          state; commit actionId
```

### Late join (bootstrap)

```text
new peer (state = null) → all: STATE_REQUEST(bootstrap scope), remembers actionId
controller → new peer: STATE_SNAPSHOT(truncated state, requestActionId = that actionId)
new peer: deep-validate; authorize (solicited response); apply; commit
(controller additionally pushes on onPeerJoin — both paths converge)
```

### Simultaneous starts

```text
A and B both start from null state → both broadcast SESSION_STARTED (rev 0)
every peer: keep session with lexicographically smaller controllerPeerId
loser (say B): discards own session, adopts A's; its stray SESSION_STARTED is
  rejected everywhere by the same rule
```

### Revision gap

```text
replica has n; receives n + 2 (actionId NOT committed)
replica → recoveryTarget: STATE_REQUEST(n), remembers actionId
target → replica: STATE_SNAPSHOT(current, requestActionId echoed)
```

### Controller disconnect (election handshake)

```text
all remaining peers detect the same transport leave
each computes winner W = electController([selfId, ...getPeers()])
non-winners → W: ELECTION_ADVERTISE(own truncated state)
W: waits electionWindowMs; adopts chooseElectionState([own, ...advertised])
W → all: CONTROLLER_CHANGED(adopted.revision + 1)
replicas: accept only from their computed winner; supersession by
  (higher revision, then lower peer ID) resolves races; gap recovery targets
  the announcer, not the departed controller
W: pushes snapshots to peers that advertised lower revisions
```
