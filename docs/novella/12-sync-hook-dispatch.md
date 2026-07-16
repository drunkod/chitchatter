# 12 — Sync hook: pre-dispatch gate, handlers, send path, flows

> **Revision 6 changes:** the gate uses the **action-aware** primitives (08): `isTombstonedFor` (embedded-session check — start envelopes carry the bootstrap scope) and `isStaleEpoch` with `≤` for start actions; one narrow duplicate exception re-acks duplicate `SESSION_ENDED` (11); `SESSION_END_ACK` dispatches to the termination round; the sync service is constructed from persisted `RoomMeta` before processing any envelope (08/15); commit-holder gossip hooks for start decision recovery (09).

## Hook shape

```ts
interface Options {
  transport: VisualNovelTransport
  story: VisualNovelManifest | null
  state: VisualNovelSessionState | null
  setState: (state: VisualNovelSessionState | null) => void
  onParticipationChange: (participation: VisualNovelParticipation) => void
  onSessionEnded: (sessionId: string) => void // checkpoint clearing (15)
  onProtocolError: (message: string) => void
}

// Returned API:
// {
//   phase: 'idle' | 'start-round-pending' | 'election-pending' | 'terminating',
//   startSession, switchSession, endSession,        // 09 / 09 / 11
//   leaveSession, rejoinSession,                     // 11
//   requestAdvance, requestChoice, requestRestart,
// }
```

Internal refs: `stateRef`, `storyRef`, `engineRef`, `sendRef`, `participationRef` (11), `outstandingRequestIdRef`, `pendingStartRef` + `startRoundRef` (09), `electionRoundRef` (10), `pendingTerminationRef` (11), `requestQueueRef` (promise queue serializing controller-side handling).

## Receive path

```ts
const onReceive = async (input: unknown, context: MessageContext) => {
  // 1. Structure + normalization (03)
  const validated = validateEnvelope(input)
  if (!validated.ok) return warn(validated.errors)
  const envelope = validated.value

  // 2. Transport identity
  if (envelope.senderPeerId !== context.peerId) return

  // 3. PRE-DISPATCH GATE (08) — one place, every envelope, before handlers.
  //    isTombstonedFor checks the EMBEDDED session for start actions (their
  //    outer scope is "bootstrap"); isStaleEpoch is ≤ for start actions, <
  //    otherwise (decided epochs never reopen).
  if (sync.isTombstonedFor(envelope) &&
      envelope.actionType !== 'STATE_REQUEST') return   // sole tombstone exception (11)
  if (sync.isDuplicate(envelope.actionId)) {
    // Sole duplicate exception: a duplicate SESSION_ENDED means the sender
    // has not recorded our ack — re-ack, still no re-application (11).
    if (envelope.actionType === 'SESSION_ENDED') void resendEndAck(envelope, context)
    return
  }
  if (sync.isStaleEpoch(envelope)) return

  // 4. Durable participation guard — reads the REF (11), never React state.
  if (participationRef.current.kind === 'left-current-session' &&
      envelope.sessionId === participationRef.current.sessionId) return

  // 5. Exhaustive dispatch.
  switch (envelope.actionType) {
    case 'START_PROPOSE':    return handleStartPropose(envelope, context)   // 09
    case 'START_COMMITTED':  return handleStartCommitted(envelope, context) // 09
    case 'STATE_REQUEST':
    case 'ADVANCE_REQUEST':
    case 'CHOICE_REQUEST':
    case 'RESTART_REQUEST':
      return enqueue(() => handleRequest(envelope, context))
    case 'STATE_SNAPSHOT':
    case 'RESTARTED':        return applySnapshotClass(envelope, context)
    case 'SESSION_STARTED':  return applySwitch(envelope, context)          // 09
    case 'SESSION_ENDED':    return applySessionEnded(envelope, context)    // 11
    case 'SESSION_END_ACK':  return handleSessionEndAck(envelope, context)  // 11
    case 'ADVANCED':
    case 'CHOICE_RESOLVED':  return applyProgression(envelope, context)
    case 'CONTROLLER_CHANGED':
      return applyControllerChange(envelope, context)                       // 10
    case 'ELECTION_ADVERTISE':
      return collectElectionAdvertisement(envelope, context)                // 10
    case 'ERROR':            return surfaceError(envelope) // no mutation, no commit
    case 'CONTROL_REQUEST':
    case 'CONTROL_PASSED':   return rejectUnimplemented(envelope) // M3; no commit
  }
  // No default: exhaustive over VisualNovelActionType — a new action type
  // fails check:types until a handler and a matrix row (08) exist.
}
```

Every handler ends with `sync.commit(envelope)` **only** on success. Handlers do not repeat gate checks.

## Handlers (rules; round-specific code in 09/10/11)

- **`handleRequest`** (controller, serialized): `inspectRequest` (08). If a termination is pending for the session → reply with the pending end envelope (a per-request delivery retry, 11). For advance/choice/restart: `expectedRevision !== current.revision` → targeted snapshot reply. Otherwise engine transition → apply locally → `broadcastCanonical`. `STATE_REQUEST` → `toSnapshotState(current)` with `requestActionId: envelope.actionId`; for a tombstoned session → **retained end notice** (`sync.getRetainedEndNotice`, works after finalization and reload, 08/11); for a decided start epoch → the **held commit** (decision-recovery gossip, 09).
- **`applySnapshotClass`**: resolve story from catalog → missing story is the recoverable "story unavailable" path (04/06) → `validateSessionAgainstStory` → `sync.authorizeSnapshot(…, outstandingRequestIdRef.current)` → `setState(snapshot)`; `sync.noteEpoch(snapshot.sessionEpoch)`; clear `outstandingRequestIdRef`.
- **`applySwitch`** (`SESSION_STARTED`): semantic validation → `authorizeSnapshot` (controller-only, epoch exactly `+1`, revision 0 — 08) → tombstone the replaced session (`sync.tombstone(current.sessionId, current.sessionEpoch)`), clear its checkpoint (15) → `setState(next)`.
- **`applyProgression`**: `inspectProgression` (08) → on `recover`: `STATE_REQUEST` to `recoveryTarget(...)`, remember `outstandingRequestIdRef`. On `apply`: **engine replay** —

  ```ts
  const derived = envelope.actionType === 'ADVANCED'
    ? engine.advance(current)
    : engine.choose(current, payload.choiceId)
  const matches = derived.sceneId === payload.sceneId &&
    derived.dialogueEntryId === payload.dialogueEntryId &&
    (envelope.actionType !== 'CHOICE_RESOLVED' ||
      deepEqual(derived.variables, payload.variables))
  if (!matches) return recover('replay-mismatch')
  setState({ ...derived, revision: envelope.revision, updatedAt: envelope.timestamp })
  sync.commit(envelope)
  ```

- **`applySessionEnded`**: progression rules → tombstone → `setState(null)` → `onSessionEnded` → commit (11).
- **`applyControllerChange`**: semantic validation of the adopted state → `authorizeControllerChange` with the frozen round (10) → `setState(payload.state)` atomically → record `round.applied` → commit.
- **`collectElectionAdvertisement`**: frozen-winner + `roundId` + epoch checks (10) → buffer.
- **`rejectUnimplemented`**: log, optional targeted `ERROR('UNSUPPORTED_ACTION')`; never commit.

## Recovery targeting

```ts
const recoveryTarget = (
  current: VisualNovelSessionState | null,
  envelope: VisualNovelActionEnvelope
): string => {
  if (!current) return envelope.senderPeerId
  return transport.getPeers().includes(current.controllerPeerId)
    ? current.controllerPeerId
    : envelope.senderPeerId // controller departed (e.g. migration in flight)
}
```

Every `recover` sends `STATE_REQUEST` to `recoveryTarget(...)` and records the request's `actionId` in `outstandingRequestIdRef` (solicited-snapshot acceptance, 08).

## Send path (controller)

`broadcastCanonical(actionType, payload, next)` — progression events only (`SESSION_ENDED` has its own rule, 11):

1. Apply `next` locally (controller state may not regress).
2. `await send(envelope)`; retry `canonicalSendRetries` times on rejection.
3. Still failing → broadcast `STATE_SNAPSHOT` of current state (retried on the next canonical event too) and surface a sync warning. Canonical state is never silently ahead of the room without a pending repair.

## Peer lifecycle effects

- `onPeerJoin(VISUAL_NOVEL)`: controller pushes `toSnapshotState(current)`; if a termination is pending, push the end envelope instead (11). Joins during an election round are deferred (10).
- `onPeerLeave(VISUAL_NOVEL)`: departed peer is the current controller → open/f freeze an election round (10); departed peer is any other electorate member during an open round → deterministic round restart (10).
- Mount with null state and `participationRef.current.kind === 'joined'` → one bootstrap `STATE_REQUEST` (broadcast; only the controller answers), record `outstandingRequestIdRef`.
- Cleanup: keyed `removePeerJoinHandler`/`removePeerLeaveHandler` only — never `flush()`.

## Protocol flows

### Choice request

```text
participant → controller: CHOICE_REQUEST(expectedRevision, choiceId)
controller: gate → authorize → engine.choose (serialized) → apply locally
controller → all: CHOICE_RESOLVED(revision + 1, delta)
replicas: gate → authorize (controller + exact revision) → ENGINE REPLAY → apply
```

### Fresh start (09)

```text
starter → coordinator: START_PROPOSE(roundId, candidate rev 0, epoch n+1)
coordinator: collect startRoundMs → select min(controllerPeerId, sessionId)
coordinator → all: START_COMMITTED(roundId, state @ epoch n+1)
everyone (starters included): install ONLY the commit; gate kills stragglers
```

### Late join (bootstrap)

```text
new peer (null state, joined) → all: STATE_REQUEST(bootstrap scope) [remember id]
controller → new peer: STATE_SNAPSHOT(truncated, requestActionId echoed)
new peer: structure → gate → semantics → solicited authorization → apply
(ended session? → end envelope instead of a snapshot)
```

### Revision gap

```text
replica has n; receives n + 2 (NOT committed)
replica → recoveryTarget: STATE_REQUEST(n) [remember id]
target → replica: STATE_SNAPSHOT(current, requestActionId echoed)
```

### Story switch (09) / Session end (11) / Controller disconnect (10)

See the dedicated steps; all three end with stragglers for retired sessions
dying at the pre-dispatch gate.
