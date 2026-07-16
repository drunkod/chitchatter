# 03 — Runtime structural validation and normalization

> **Revision 7 changes:** validates the new start-gossip and reconciliation actions, binds start decisions to deterministic IDs, normalizes persisted room metadata, and removes every trust-on-cast path.

## Validation order

1. Reject values that are not bounded records.
2. Enforce `maxEnvelopeBytes` before deep traversal.
3. Validate primitive fields and action type.
4. Validate and normalize the action payload.
5. Cross-check envelope scope against embedded state.
6. Return a fresh envelope; drop unknown properties and the reserved MVP `proof`.

The existing `isId`, `isEpoch`, `isRevision`, `utf8Bytes`, `validateVariables`, `validateHistory`, `validateSessionState`, and semantic-validation boundaries remain.

## Start decision validation

```ts
const validateStartDecision = (
  input: unknown
): ValidationResult<StartDecisionRecord> => {
  if (!isRecord(input)) return fail('Start decision must be an object')
  if (!isId(input.decisionId) ||
      !isId(input.coordinatorPeerId) ||
      !isId(input.originActionId)) {
    return fail('Invalid start decision identifiers')
  }

  const state = validateSessionState(input.state)
  if (!state.ok) return state
  if (state.value.revision !== 0) return fail('Start decision state must be revision 0')

  const expectedId = deriveRoundId([
    'start',
    state.value.sessionEpoch,
    input.coordinatorPeerId,
    input.originActionId,
    state.value.controllerPeerId,
    state.value.sessionId,
  ].join(':'))
  if (input.decisionId !== expectedId) {
    return fail('Start decision ID does not bind its fields')
  }

  return {
    ok: true,
    value: {
      decisionId: input.decisionId,
      coordinatorPeerId: input.coordinatorPeerId,
      originActionId: input.originActionId,
      state: state.value,
    },
  }
}
```

## New payload cases

```ts
case 'START_PROPOSE': {
  if (!isId(payload.proposalId)) return fail('Invalid proposalId')
  const candidate = validateSessionState(payload.candidate)
  if (!candidate.ok) return candidate
  if (candidate.value.revision !== 0) return fail('Start candidate must be revision 0')
  return { ok: true, value: { proposalId: payload.proposalId, candidate: candidate.value } }
}

case 'START_COMMITTED': {
  const decision = validateStartDecision(payload.decision)
  if (!decision.ok) return decision
  if (decision.value.coordinatorPeerId !== senderPeerId) {
    return fail('Start commit sender/coordinator mismatch')
  }
  return { ok: true, value: { decision: decision.value } }
}

case 'START_DECISION_GOSSIP': {
  const decision = validateStartDecision(payload.decision)
  if (!decision.ok) return decision
  const knownState = validateSessionState(payload.knownState)
  if (!knownState.ok) return knownState
  if (knownState.value.sessionEpoch !== decision.value.state.sessionEpoch ||
      knownState.value.sessionId !== decision.value.state.sessionId) {
    return fail('Gossip state does not belong to the decision')
  }
  return {
    ok: true,
    value: { decision: decision.value, knownState: knownState.value },
  }
}

case 'SESSION_RECONCILE': {
  if (payload.reason !== 'start-conflict' &&
      payload.reason !== 'migration-conflict') return fail('Invalid reconcile reason')
  const state = validateSessionState(payload.state)
  return state.ok
    ? { ok: true, value: { reason: payload.reason, state: state.value } }
    : state
}

case 'SESSION_END_ACK':
  return isId(payload.endActionId)
    ? { ok: true, value: { endActionId: payload.endActionId } }
    : fail('Invalid end acknowledgement')
```

## Election payloads

`CONTROLLER_CHANGED.electorate` must be non-empty, sorted, unique, bounded to 64, contain valid IDs, and exclude the departed peer. Recompute:

```ts
const expectedRoundId = deriveRoundId(
  `${state.sessionEpoch}:${departedControllerPeerId}:${electorate.join(',')}`
)
```

Require `controllerPeerId === state.controllerPeerId === senderPeerId` and `controllerPeerId === electController(electorate)`.

## Envelope scope checks

- `START_PROPOSE`, `START_COMMITTED`, and `START_DECISION_GOSSIP` use bootstrap outer scope and outer revision 0.
- For `START_PROPOSE`, embedded controller equals sender.
- For `START_COMMITTED`, embedded coordinator equals sender.
- Gossip and reconciliation outer sender is only the forwarder; do not require it to equal the state controller.
- Every other state-carrying action must match envelope session/story/version/revision.

## `RoomMeta` validator

```ts
export const validateRoomMeta = (input: unknown): ValidationResult<RoomMeta> => {
  if (utf8Bytes(input) > visualNovelLimits.maxRoomMetaBytes) {
    return fail('Room metadata is too large')
  }
  if (!isRecord(input) || input.version !== 1 || !isRevision(input.highWaterEpoch)) {
    return fail('Invalid room metadata')
  }
  if (!Array.isArray(input.endedSessions) ||
      input.endedSessions.length > visualNovelLimits.maxPersistedTombstones) {
    return fail('Invalid persisted tombstones')
  }

  const endedSessions: PersistedEndNotice[] = []
  const seen = new Set<string>()
  for (const item of input.endedSessions) {
    if (!isRecord(item) || !isId(item.sessionId) || !isEpoch(item.epoch)) {
      return fail('Invalid persisted tombstone')
    }
    const end = validateEnvelope(item.endEnvelope)
    if (!end.ok || end.value.actionType !== 'SESSION_ENDED' ||
        end.value.sessionId !== item.sessionId) {
      return fail('Invalid retained end notice')
    }
    if (seen.has(item.sessionId)) return fail('Duplicate persisted tombstone')
    seen.add(item.sessionId)
    endedSessions.push({
      sessionId: item.sessionId,
      epoch: item.epoch,
      endEnvelope: end.value as EnvelopeFor<'SESSION_ENDED'>,
    })
  }

  let activeStartDecision: StartDecisionRecord | null = null
  if (input.activeStartDecision !== null) {
    const validated = validateStartDecision(input.activeStartDecision)
    if (!validated.ok) return validated
    activeStartDecision = validated.value
  }

  return {
    ok: true,
    value: {
      version: 1,
      highWaterEpoch: input.highWaterEpoch,
      endedSessions,
      activeStartDecision,
    },
  }
}
```

Corrupt metadata does not silently become empty metadata while the network receiver is active. The bootstrap UI surfaces the problem and requires reset or retry before novella writes are enabled.

## Required tests

- Every validator returns fresh nested objects.
- A holder can forward a start decision without failing sender/context identity, because only the outer envelope sender is checked against transport context.
- Decision ID tampering, gossip-state mismatch, invalid reconciliation reason, and malformed retained notices are rejected.
- Metadata normalization restores retained envelopes and honors the configured tombstone bound.
