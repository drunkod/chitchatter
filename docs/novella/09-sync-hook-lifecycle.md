# 09 — Sync hook: dispatch, lifecycle, and protocol flows

> **Revision 4 changes:** a **start-arbitration phase** with progression locked (fixing the split-room race where one starter advanced before the competing start arrived); a durable **participation state** so a participant who leaves stays left — the receiver ignores that session and sends no bootstrap recovery until explicit rejoin; `SESSION_ENDED` application tombstones and clears checkpoints; `CONTROLLER_CHANGED` applies its embedded snapshot atomically inside the round rules from 08.

## Hook shape

```ts
import type { VisualNovelParticipation } from 'models/visualNovel'

interface Options {
  transport: VisualNovelTransport
  story: VisualNovelManifest | null
  state: VisualNovelSessionState | null
  participation: VisualNovelParticipation
  setState: (state: VisualNovelSessionState | null) => void
  onSessionEnded: (sessionId: string) => void // clears checkpoint (12), lobby
  onProtocolError: (message: string) => void
}

// Returned API:
// {
//   phase: 'idle' | 'arbitrating',
//   startSession, endSession, rejoinSession,
//   requestAdvance, requestChoice, requestRestart,
// }
```

Internal refs (all mutable, render-safe): `stateRef`, `storyRef`, `engineRef`, `sendRef`, `outstandingRequestIdRef`, `electionRoundRef: ElectionRound | null`, `arbitrationRef: { candidates: VisualNovelSessionState[]; openedAt: number } | null`, `requestQueueRef` (promise queue serializing controller-side request handling).

## Receive path — exhaustive dispatch

```ts
const onReceive = async (input: unknown, context: MessageContext) => {
  const validated = validateEnvelope(input) // structural + normalization (03)
  if (!validated.ok) return warn(validated.errors)
  const envelope = validated.value
  if (envelope.senderPeerId !== context.peerId) return

  // Durable leave: while 'left-current-session', envelopes for that session
  // are ignored entirely — no recovery, no rejoin-by-snapshot.
  if (participation.kind === 'left-current-session' &&
      envelope.sessionId === participation.sessionId) {
    return
  }

  switch (envelope.actionType) {
    case 'STATE_REQUEST':
    case 'ADVANCE_REQUEST':
    case 'CHOICE_REQUEST':
    case 'RESTART_REQUEST':
      return enqueue(() => handleRequest(envelope, context)) // controller only
    case 'STATE_SNAPSHOT':
    case 'RESTARTED':
      return applySnapshotClass(envelope, context)
    case 'SESSION_STARTED':
      return handleSessionStarted(envelope, context)
    case 'SESSION_ENDED':
      return applySessionEnded(envelope, context)
    case 'ADVANCED':
    case 'CHOICE_RESOLVED':
      return applyProgression(envelope, context)
    case 'CONTROLLER_CHANGED':
      return applyControllerChange(envelope, context)
    case 'ELECTION_ADVERTISE':
      return collectElectionAdvertisement(envelope, context)
    case 'ERROR':
      return surfaceError(envelope) // never mutates state, never committed
    case 'CONTROL_REQUEST':
    case 'CONTROL_PASSED':
      return rejectUnimplemented(envelope) // M3; reject, do NOT commit
  }
  // No default: exhaustive over VisualNovelActionType — a new action type
  // fails check:types until a handler and a matrix row (08) exist.
}
```

Every handler ends with `sync.commit(envelope)` **only** on success.

## Handlers

### `handleRequest` (controller, serialized)

`inspectRequest` (08) → for advance/choice/restart, `expectedRevision !== current.revision` → targeted snapshot reply and return. Otherwise run the engine, apply locally, broadcast canonical (send path below). `STATE_REQUEST` replies with `toSnapshotState(current)` and `requestActionId: envelope.actionId`.

### `applySnapshotClass` (`STATE_SNAPSHOT` / `RESTARTED`)

```ts
const snapshot = (envelope.payload as { state: VisualNovelSessionState }).state
const manifest = getBundledStory(snapshot.storyId, snapshot.storyVersion)
if (!manifest) return onProtocolError('Story unavailable in this build') // recoverable, no loop
const semantic = validateSessionAgainstStory(snapshot, manifest) // (04)
if (!semantic.ok) return // never reaches setState → no render-time throw
if (!sync.authorizeSnapshot(envelope, snapshot, current,
    context.peerId, outstandingRequestIdRef.current)) return
setState(snapshot)
outstandingRequestIdRef.current = null
sync.commit(envelope)
```

### `handleSessionStarted` — start arbitration

```ts
// Story switch on a progressed session: authorizeSnapshot handles it
// (controller-only). Fresh starts go through arbitration:
if (current && current.revision > 0) {
  if (!sync.authorizeSnapshot(envelope, snapshot, current, context.peerId, null)) return
  ...semantic validation → setState → commit; return
}
// Arbitration phase: collect candidates for startArbitrationMs with
// progression locked; applies to our OWN start too (startSession below).
if (!arbitrationRef.current) {
  arbitrationRef.current = { candidates: [], openedAt: now() }
  scheduleArbitrationClose() // setTimeout(startArbitrationMs)
}
arbitrationRef.current.candidates.push(snapshot) // semantic-validated first
sync.commit(envelope)
```

On window close: `winner = sync.chooseStartCandidate(candidates)`; `setState(winner)`; unlock progression; discard the rest. A starter whose session lost simply adopts the winner — its own `SESSION_STARTED` is outcompeted by the same rule at every conformant peer, regardless of arrival order, because **no peer progresses during the window**. Progression events that raced ahead from a non-conformant/legacy peer resolve through normal gap recovery afterward.

### `applyProgression` (`ADVANCED` / `CHOICE_RESOLVED`)

`inspectProgression` (08) → on `recover`: targeted `STATE_REQUEST` to `recoveryTarget(...)` (below), remember `outstandingRequestIdRef`. On `apply`: **engine replay** —

```ts
const derived = envelope.actionType === 'ADVANCED'
  ? engine.advance(current)
  : engine.choose(current, payload.choiceId)
const matches = derived.sceneId === payload.sceneId &&
  derived.dialogueEntryId === payload.dialogueEntryId &&
  (envelope.actionType !== 'CHOICE_RESOLVED' ||
    deepEqual(derived.variables, payload.variables))
if (!matches) return recover('replay-mismatch') // never apply blind casts
setState({ ...derived, revision: envelope.revision, updatedAt: envelope.timestamp })
sync.commit(envelope)
```

### `applySessionEnded`

Reuses `inspectProgression` (controller-only, same session, exact `revision + 1`) → `sync.tombstone(envelope.sessionId, envelope.timestamp)` → `setState(null)` → `onSessionEnded(envelope.sessionId)` (clears checkpoint + latest pointer, 12) → commit. Stale/duplicate end events for newer restarted sessions are ignored by the revision rule; late events for the ended session are ignored by the tombstone.

### `applyControllerChange`

```ts
const payload = envelope.payload // { departedControllerPeerId, controllerPeerId, state }
...semantic validation of payload.state against its story (04)
const decision = sync.authorizeControllerChange(envelope, current,
  context.peerId, selfId, transport.getPeers(), electionRoundRef.current, now())
if (!decision.ok) return
setState(payload.state) // ATOMIC: controller + content together
electionRoundRef.current = {
  ...(electionRoundRef.current ?? {
    departedControllerPeerId: payload.departedControllerPeerId,
    openedAt: now(), advertised: [],
  }),
  applied: { revision: payload.state.revision, controllerPeerId: payload.controllerPeerId },
}
sync.commit(envelope)
```

The round stays open for supersession until `electionRoundMs` elapses, then `electionRoundRef.current = null`.

### `collectElectionAdvertisement`

Only while self is the computed winner of an open round; semantic-validate each advertised state; buffer into `electionRoundRef.current.advertised`. *(Provenance is a crash-fault concession — 00.)*

## Recovery targeting

```ts
const recoveryTarget = (current: VisualNovelSessionState | null,
  envelope: VisualNovelActionEnvelope): string => {
  if (!current) return envelope.senderPeerId
  return transport.getPeers().includes(current.controllerPeerId)
    ? current.controllerPeerId
    : envelope.senderPeerId // controller departed (e.g. migration in flight)
}
```

Every `recover` decision sends `STATE_REQUEST` to `recoveryTarget(...)` and records the request's `actionId` in `outstandingRequestIdRef`.

## Send path (controller)

`broadcastCanonical(actionType, payload, next)`:

1. Apply `next` locally (the controller is the authority — its state may not regress).
2. `await send(envelope)`; on rejection retry `canonicalSendRetries` times.
3. Still failing → broadcast a full `STATE_SNAPSHOT` of current state (retried on the next canonical event if that also fails) and surface a sync warning. Canonical state is never silently ahead of the room without a pending repair.

## Session lifecycle API

- `startSession(initial)` — only when local state is null and no arbitration is open; broadcasts `SESSION_STARTED` (revision 0) **and enters its own arbitration phase** with `initial` as a candidate; resolves when the window closes (possibly adopting a competitor).
- `endSession()` — controller only; broadcasts `SESSION_ENDED` at `revision + 1`, tombstones locally, clears state + checkpoint.
- Participant leave (managed in `useVisualNovel`, 10): sets `participation = { kind: 'left-current-session', sessionId }`, clears local state. The receive path then ignores that session — no "missing state" recovery, no silent rejoin on the next announcement.
- `rejoinSession()` — resets participation to `joined` and sends a bootstrap `STATE_REQUEST`.
- Controller "leave story" is not a local operation: pass control (M3) or `endSession()`.

## Peer lifecycle effects

- `onPeerJoin(VISUAL_NOVEL)`: controller pushes `toSnapshotState(current)` to the joiner.
- `onPeerLeave(VISUAL_NOVEL)`: if the departed peer is the current controller, open an election round:
  - `electionRoundRef.current = { departedControllerPeerId: peerId, openedAt: now(), advertised: [], applied: null }`;
  - `winner = sync.electController([selfId, ...transport.getPeers()])`;
  - not the winner → send targeted `ELECTION_ADVERTISE { state: toSnapshotState(current) }` to the winner;
  - the winner → collect advertisements for `electionRoundMs`, adopt `chooseElectionState([own, ...advertised])`, apply `engine.changeController(adopted, selfId)`, broadcast `CONTROLLER_CHANGED { departedControllerPeerId, controllerPeerId: selfId, state: toSnapshotState(next) }`.
- Cleanup: keyed `removePeerJoinHandler`/`removePeerLeaveHandler` only.
- On mount with null state **and** `participation.kind === 'joined'`: one bootstrap `STATE_REQUEST` (broadcast; only the controller handles it), record `outstandingRequestIdRef`.

## Protocol flows

### Choice request

```text
participant → controller: CHOICE_REQUEST(expectedRevision, choiceId)
controller: authorize; engine.choose (serialized queue); apply locally
controller → all: CHOICE_RESOLVED(revision + 1, delta)
replicas: authorize controller + exact revision; ENGINE REPLAY; apply derived
```

### Late join (bootstrap)

```text
new peer (null state, joined) → all: STATE_REQUEST(bootstrap scope), remembers actionId
controller → new peer: STATE_SNAPSHOT(truncated, requestActionId echoed)
new peer: structural → semantic → authorization (solicited) → apply → commit
```

### Simultaneous starts (arbitration)

```text
A and B start concurrently → both broadcast SESSION_STARTED (rev 0)
every peer (incl. A and B): enter arbitration; progression LOCKED
window closes → winner = min(controllerPeerId, sessionId) → everyone adopts
B's stray session cannot advance meanwhile (locked), so no revision-1 race
```

### Session end

```text
controller → all: SESSION_ENDED(revision + 1)
replicas: exact-next revision → tombstone(sessionId) → clear state + checkpoint
late RESTARTED / delayed old SESSION_ENDED for that session → tombstoned, ignored
```

### Controller disconnect (election round)

```text
remaining peers detect the leave → each opens round(departed = old controller)
each computes winner W = electController([selfId, ...getPeers()])
non-winners → W: ELECTION_ADVERTISE(own truncated state)
W: waits electionRoundMs → adopts chooseElectionState([own, ...advertised])
W → all: CONTROLLER_CHANGED(departed, W, adopted snapshot)
replicas: winner-only + round rules → apply snapshot ATOMICALLY
race with second announcement: round-scoped supersession (higher revision,
  then lower winner ID) converges every replica; behind-replicas need no
  extra snapshot round-trip — the state travelled with the announcement
```
