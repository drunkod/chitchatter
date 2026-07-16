# 12 — Sync runtime, dispatch, and recovery

> **Revision 7 changes:** receiver attachment is explicitly delayed until metadata bootstrap, gate decisions can perform re-ack/reply work, start gossip and session reconciliation have dedicated handlers, and snapshot recovery is bound to an exact target record.

## Runtime options

```ts
interface Options {
  transport: VisualNovelTransport
  initialMeta: RoomMeta
  persistMeta: (meta: RoomMeta) => Promise<void>
  story: VisualNovelManifest | null
  state: VisualNovelSessionState | null
  setState: (state: VisualNovelSessionState | null) => void
  onParticipationChange: (value: VisualNovelParticipation) => void
  onSessionEnded: (sessionId: string) => Promise<void>
  onProtocolError: (message: string) => void
}
```

`useVisualNovelSync` is mounted only after `initialMeta` exists. The receiver is connected inside an effect in this mounted child; there is no disabled service that processed early envelopes with empty metadata.

## Receive path

```ts
const onReceive = async (input: unknown, context: MessageContext) => {
  const validated = validateEnvelope(input)
  if (!validated.ok) return warn(validated.errors)
  const envelope = validated.value
  if (envelope.senderPeerId !== context.peerId) return

  const gate = sync.inspectGate(envelope)
  if (gate.kind === 'reack-end') {
    await resendEndAck(envelope as EnvelopeFor<'SESSION_ENDED'>, context.peerId)
    return
  }
  if (gate.kind === 'reply-ended') {
    await send(gate.notice, { target: context.peerId })
    return
  }
  if (gate.kind === 'drop') return

  const subjectSessionId = sync.subjectSessionId(envelope)
  if (participationRef.current.kind === 'left-current-session' &&
      subjectSessionId === participationRef.current.sessionId) return

  switch (envelope.actionType) {
    case 'START_PROPOSE': return handleStartPropose(envelope, context)
    case 'START_COMMITTED': return handleStartCommitted(envelope, context)
    case 'START_DECISION_GOSSIP': return handleStartDecisionGossip(envelope, context)
    case 'SESSION_RECONCILE': return applySessionReconcile(envelope, context)
    case 'STATE_REQUEST':
    case 'ADVANCE_REQUEST':
    case 'CHOICE_REQUEST':
    case 'RESTART_REQUEST':
      return enqueue(() => handleRequest(envelope, context))
    case 'STATE_SNAPSHOT':
    case 'RESTARTED': return applySnapshotClass(envelope, context)
    case 'SESSION_STARTED': return applySwitch(envelope, context)
    case 'SESSION_ENDED': return applySessionEnded(envelope, context)
    case 'SESSION_END_ACK': return handleSessionEndAck(envelope, context)
    case 'ADVANCED':
    case 'CHOICE_RESOLVED': return applyProgression(envelope, context)
    case 'CONTROLLER_CHANGED': return applyControllerChange(envelope, context)
    case 'ELECTION_ADVERTISE': return collectElectionAdvertisement(envelope, context)
    case 'ERROR': return surfaceError(envelope)
    case 'CONTROL_REQUEST':
    case 'CONTROL_PASSED': return rejectUnimplemented(envelope)
  }
}
```

## Recovery requests

Never store only one request ID without its target:

```ts
const requestState = async (
  targetPeerId: string,
  expectedEpoch: number,
  kind: RecoveryKind,
) => {
  const envelope = makeStateRequest(kind)
  outstandingRecoveryRef.current = {
    actionId: envelope.actionId,
    targetPeerId,
    expectedEpoch,
    kind,
    createdAt: now(),
  }
  await send(envelope, { target: targetPeerId })
}
```

`STATE_SNAPSHOT` is solicited only when both the echoed action ID and `context.peerId` match this record. Cross-session replacement is then allowed only for bootstrap/reconciliation kinds and only when the incoming state wins the relevant ordering.

## Start handlers

- `START_COMMITTED`: authorize origin coordinator, then call `acceptStartDecision(..., context.peerId)`.
- `START_DECISION_GOSSIP`: outer sender is the holder; validate embedded decision and known state, then call the same acceptance routine with `context.peerId`.
- `SESSION_RECONCILE`: require an open conflict record for the epoch and apply only if the incoming complete state wins `compareSessionPriority`.
- On a losing local state whose winning controller is reachable, prefer exact-target `STATE_REQUEST`; otherwise accept the normalized full reconciliation state under the honest-peer concession.

## Migration handler

Semantic validation precedes `authorizeControllerChange`. The handler uses the retained `MigrationRecord`, not `current.controllerPeerId`, for supersession. It records the complete applied state and keeps the record until `migrationSupersessionMs` expires.

## Request handling

Priority order:

1. retained end notice for a tombstoned session;
2. pending termination end notice;
3. held start decision gossip for bootstrap/confused proposal;
4. controller snapshot or serialized progression request.

## Canonical send failure

Progression still applies locally, retries, then advertises repair. Repairs should target known lagging peers when possible. A generic snapshot broadcast is not sufficient proof of delivery, but eventual subsequent requests and exact-target recovery close the gap under the stated model.

## Lifecycle cleanup

Timers for requests, start collection, reconciliation retry, migration supersession, and termination ACK cycles are cleared on unmount. Remove only novella’s keyed peer handlers; never flush shared room handlers.
