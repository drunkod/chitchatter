# 11 — Session termination, acknowledgements, and participation

> **Revision 7 changes:** duplicate end notices re-ack before tombstone suppression, stale requests and progression receive the retained end notice, and metadata persistence is part of finalization rather than a best-effort afterthought.

## Controller termination round

```ts
const endSession = async () => {
  const current = stateRef.current
  if (!current || current.controllerPeerId !== selfId) return
  if (pendingTerminationRef.current) return

  const envelope = createVisualNovelEnvelope(
    'SESSION_ENDED', {}, current, selfId, current.revision + 1, dependencies)

  pendingTerminationRef.current = {
    sessionId: current.sessionId,
    sessionEpoch: current.sessionEpoch,
    envelope,
    recipients: new Set(transport.getPeers()),
    acked: new Set(),
  }
  setPhase('terminating')
  await disseminateTermination()
}
```

The controller retains state and authority. Progression, switch, and fresh start are disabled.

## Ack loop

Send the same end envelope/action ID to unacknowledged recipients every `terminationAckTimeoutMs`. A recipient departure removes it from the frozen set. Finalization occurs only when no recipient remains outstanding.

```ts
const handleSessionEndAck = (envelope, context) => {
  const pending = pendingTerminationRef.current
  if (!pending) return
  if (!pending.recipients.has(context.peerId)) return
  if (envelope.payload.endActionId !== pending.envelope.actionId) return
  pending.acked.add(context.peerId)
  sync.commit(envelope)
  maybeFinalize()
}
```

## Replica receive order

The gate must check duplicate end notices before tombstones:

```ts
const gate = sync.inspectGate(envelope)
switch (gate.kind) {
  case 'reack-end':
    await sendEndAck(envelope, context.peerId)
    return
  case 'reply-ended':
    await send(gate.notice, { target: context.peerId })
    return
  case 'drop':
    return
  case 'dispatch':
    break
}
```

On first application:

1. validate controller and exact next revision;
2. persist the tombstone and retained end envelope;
3. send `SESSION_END_ACK` to the sender;
4. clear state and checkpoint;
5. commit the received action ID.

If the ACK is lost, a duplicate end envelope takes the `reack-end` path even though the session is already tombstoned.

## Retained notices

Tombstoned `STATE_REQUEST`, advance, choice, and restart traffic receives the retained end notice rather than silence. Other tombstoned traffic is dropped. The notice remains in validated `RoomMeta` after reload.

## Critical persistence

Finalization awaits the RoomMeta write:

```ts
await sync.tombstone(
  pending.sessionId,
  pending.sessionEpoch,
  pending.envelope,
)
pendingTerminationRef.current = null
sync.commit(pending.envelope)
setState(null)
await onSessionEnded(pending.sessionId)
```

If persistence fails, the controller stays in `terminating`, retains state and the pending record, and retries. It must not clear authority and claim durable termination.

## Controller crash during termination

Peers that received the end remain tombstoned. Peers that did not may migrate the live session and end again. On stabilization, retained notices propagate through stale requests. The UI may transiently differ; it must not silently claim everyone has ended until acknowledgements complete.

## Participation

The sync hook owns `participationRef`. Leave sets `left-current-session` synchronously; rejoin sets `joined` before sending bootstrap. The guard reads the ref. A new higher-epoch session resets participation because leaving is scoped to one session.

## Tests

- send resolves before delivery but finalization waits for ACKs;
- first ACK dropped, duplicate end re-acks despite tombstone;
- stale progression gets retained end notice;
- wrong sender, recipient, or action ID ACK is ignored;
- RoomMeta write failure keeps termination pending;
- completed notice survives full reload and bounded tombstone trimming;
- participant rejoin snapshot delivered synchronously is applied.
