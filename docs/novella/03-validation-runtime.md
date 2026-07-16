# 03 — Runtime structural validation (normalizing)

> **Revision 5 changes:** `sessionEpoch` validated in every state; payload validators for `START_PROPOSE` / `START_COMMITTED`; `CONTROLLER_CHANGED` payload now includes `roundId` + `electorate`. Revision 4 guarantees stand: every success path returns a **freshly constructed value** (no `input as ...`, no aliasing, no surviving extra properties), aggregate byte budgets, non-throwing `utf8Bytes`.

Structural validation proves shape, bounds, and internal consistency, and yields a clean copy. It does **not** prove story-semantic consistency (04) or sender authority (08). All gates run before any state mutation (order in 12).

## Primitives

```ts
import {
  allowedVisualNovelAssetExtensions,
  visualNovelLimits,
  visualNovelProtocolVersion,
} from 'config/visualNovel'
import type {
  VisualNovelActionEnvelope, VisualNovelActionType, VisualNovelHistoryEntry,
  VisualNovelSessionState, VisualNovelValue,
} from 'models/visualNovel'

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] }

const fail = <T>(...errors: string[]): ValidationResult<T> => ({ ok: false, errors })

const actionTypes = new Set<VisualNovelActionType>([
  'START_PROPOSE', 'START_COMMITTED',
  'STATE_REQUEST', 'STATE_SNAPSHOT', 'ADVANCE_REQUEST', 'ADVANCED',
  'CHOICE_REQUEST', 'CHOICE_RESOLVED', 'SESSION_STARTED', 'SESSION_ENDED',
  'ELECTION_ADVERTISE', 'CONTROL_REQUEST', 'CONTROL_PASSED',
  'CONTROLLER_CHANGED', 'RESTART_REQUEST', 'RESTARTED', 'ERROR',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown, max = visualNovelLimits.maxTextLength) =>
  typeof value === 'string' && value.length > 0 && value.length <= max

const isId = (value: unknown): value is string =>
  isString(value, visualNovelLimits.maxIdLength) &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value as string)

const isRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0

const isEpoch = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1

const isValue = (value: unknown): value is VisualNovelValue =>
  (typeof value === 'string' &&
    value.length <= visualNovelLimits.maxVariableValueLength) ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value))

// Single size gate. Never throws — cyclic input is simply "oversized".
export const utf8Bytes = (value: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}
```

## Collections (fresh objects + aggregate byte budgets)

```ts
export const validateVariables = (
  input: unknown
): ValidationResult<Record<string, VisualNovelValue>> => {
  if (!isRecord(input)) return fail('Variables must be an object')
  const entries = Object.entries(input)
  if (entries.length > visualNovelLimits.maxVariables) return fail('Too many variables')
  const fresh: Record<string, VisualNovelValue> = {}
  for (const [key, value] of entries) {
    if (!isId(key) || !isValue(value)) {
      return fail(`Invalid variable: ${String(key).slice(0, 32)}`)
    }
    fresh[key] = value as VisualNovelValue
  }
  if (utf8Bytes(fresh) > visualNovelLimits.maxVariablesBytes) {
    return fail('Variables too large')
  }
  return { ok: true, value: fresh }
}

const validateHistoryEntry = (
  input: unknown
): ValidationResult<VisualNovelHistoryEntry> => {
  if (!isRecord(input)) return fail('History entry must be an object')
  if (!isRevision(input.revision) || !isId(input.sceneId) ||
      !isId(input.dialogueEntryId) ||
      (input.choiceId !== undefined && !isId(input.choiceId))) {
    return fail('Invalid history entry')
  }
  return {
    ok: true,
    value: {
      revision: input.revision as number,
      sceneId: input.sceneId as string,
      dialogueEntryId: input.dialogueEntryId as string,
      ...(input.choiceId !== undefined ? { choiceId: input.choiceId as string } : {}),
    },
  }
}

export const validateHistory = (
  input: unknown
): ValidationResult<VisualNovelHistoryEntry[]> => {
  if (!Array.isArray(input) ||
      input.length > visualNovelLimits.maxSnapshotHistoryEntries) {
    return fail('Invalid history')
  }
  const fresh: VisualNovelHistoryEntry[] = []
  for (const entry of input) {
    const validated = validateHistoryEntry(entry)
    if (!validated.ok) return validated
    fresh.push(validated.value)
  }
  if (utf8Bytes(fresh) > visualNovelLimits.maxHistoryBytes) {
    return fail('History too large')
  }
  return { ok: true, value: fresh }
}
```

## Session state

```ts
export const validateSessionState = (
  input: unknown
): ValidationResult<VisualNovelSessionState> => {
  if (!isRecord(input)) return fail('State must be an object')
  if (utf8Bytes(input) > visualNovelLimits.maxSnapshotBytes) {
    return fail('Snapshot is too large')
  }
  const errors: string[] = []
  if (input.protocolVersion !== visualNovelProtocolVersion) {
    errors.push('Unsupported state protocol')
  }
  for (const key of ['storyId', 'storyVersion', 'sessionId', 'sceneId',
    'dialogueEntryId', 'controllerPeerId'] as const) {
    if (!isId(input[key])) errors.push(`Invalid state.${key}`)
  }
  if (!isEpoch(input.sessionEpoch)) errors.push('Invalid state.sessionEpoch')
  if (!isRevision(input.revision)) errors.push('Invalid state.revision')
  if (typeof input.updatedAt !== 'number' || !Number.isFinite(input.updatedAt)) {
    errors.push('Invalid state.updatedAt')
  }
  const variables = validateVariables(input.variables)
  if (!variables.ok) errors.push(...variables.errors)
  const history = validateHistory(input.history)
  if (!history.ok) errors.push(...history.errors)
  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    value: {
      protocolVersion: visualNovelProtocolVersion,
      storyId: input.storyId as string,
      storyVersion: input.storyVersion as string,
      sessionId: input.sessionId as string,
      sessionEpoch: input.sessionEpoch as number,
      sceneId: input.sceneId as string,
      dialogueEntryId: input.dialogueEntryId as string,
      variables: (variables as { ok: true; value: Record<string, VisualNovelValue> }).value,
      history: (history as { ok: true; value: VisualNovelHistoryEntry[] }).value,
      controllerPeerId: input.controllerPeerId as string,
      revision: input.revision as number,
      updatedAt: input.updatedAt as number,
    },
  }
}

export const toSnapshotState = (
  state: VisualNovelSessionState
): VisualNovelSessionState => {
  let history = state.history.slice(-visualNovelLimits.maxSnapshotHistoryEntries)
  while (history.length > 0 &&
         utf8Bytes(history) > visualNovelLimits.maxHistoryBytes) {
    history = history.slice(1)
  }
  return { ...state, history }
}
```

## Payloads (normalized values per action)

New/changed cases only; the Revision 4 cases (`STATE_REQUEST`, `STATE_SNAPSHOT`, `ADVANCE_REQUEST`, `ADVANCED`, `CHOICE_REQUEST`, `CHOICE_RESOLVED`, `SESSION_STARTED`, `RESTARTED`, `SESSION_ENDED`, `CONTROL_*`, `ELECTION_ADVERTISE` — the latter now also validating `roundId`, `ERROR`) are unchanged in structure and all return normalized values:

```ts
    case 'START_PROPOSE':
    case 'START_COMMITTED': {
      if (!isId(payload.roundId)) return fail('Invalid roundId')
      const stateKey = actionType === 'START_PROPOSE' ? 'candidate' : 'state'
      const state = validateSessionState(payload[stateKey])
      if (!state.ok) return state
      if (state.value.revision !== 0) return fail('Start state must be revision 0')
      return { ok: true, value: { roundId: payload.roundId, [stateKey]: state.value } }
    }

    case 'ELECTION_ADVERTISE': {
      if (!isId(payload.roundId)) return fail('Invalid roundId')
      const state = validateSessionState(payload.state)
      return state.ok
        ? { ok: true, value: { roundId: payload.roundId, state: state.value } }
        : state
    }

    case 'CONTROLLER_CHANGED': {
      if (!isId(payload.roundId) ||
          !isId(payload.departedControllerPeerId) ||
          !isId(payload.controllerPeerId)) return fail('Invalid controller change')
      if (!Array.isArray(payload.electorate) ||
          payload.electorate.length === 0 ||
          payload.electorate.length > 64 ||
          !payload.electorate.every(isId)) return fail('Invalid electorate')
      const state = validateSessionState(payload.state)
      if (!state.ok) return state
      if (state.value.controllerPeerId !== payload.controllerPeerId) {
        return fail('Controller change state/controller mismatch')
      }
      return {
        ok: true,
        value: {
          roundId: payload.roundId,
          departedControllerPeerId: payload.departedControllerPeerId,
          electorate: [...(payload.electorate as string[])],
          controllerPeerId: payload.controllerPeerId,
          state: state.value,
        },
      }
    }
```

## Envelope (rebuilt field by field)

Identical structure to Revision 4 — rebuild from validated parts, never cast — with these cross-check updates:

```ts
const stateCarryingActions = new Set<VisualNovelActionType>([
  'START_PROPOSE', 'START_COMMITTED', 'STATE_SNAPSHOT', 'SESSION_STARTED',
  'RESTARTED', 'ELECTION_ADVERTISE', 'CONTROLLER_CHANGED',
])

// Cross-checks (embedded = payload.state ?? payload.candidate):
// - envelope.sessionId/storyId/storyVersion/revision === embedded.* for every
//   state-carrying action EXCEPT the two start actions, whose envelopes use
//   the bootstrap scope (no session exists yet) while embedded.revision must
//   be 0 and envelope.revision must be 0.
// - SESSION_STARTED: embedded.controllerPeerId === senderPeerId. (Its epoch
//   rule — exactly current + 1 — is authorization, not structure: 08/09.)
// - START_PROPOSE: candidate.controllerPeerId === senderPeerId.
// - CONTROLLER_CHANGED: state.controllerPeerId === senderPeerId.
// - `proof` is dropped during normalization (reserved, 00).
```

`SESSION_STARTED` no longer requires revision 0 structurally — fresh starts moved to `START_COMMITTED`; `SESSION_STARTED` is now exclusively the controller story-switch (09), which starts the new session at revision 0 **and** epoch `current + 1`, both checked by the matrix (08).

## Message-context identity check

Unchanged: after validation, `senderPeerId !== messageContext.peerId` → drop, warn without logging secrets or payloads.

## Tests for this step

Revision 4 set (round-trip normalization incl. nested aliasing, cyclic input, aggregate byte budgets with worst-case encodings, cross-field mismatches, malformed collection elements, bootstrap scope, identity mismatch) plus:

- `sessionEpoch` missing / 0 / negative / non-integer rejected in every state-carrying payload.
- `START_PROPOSE` with candidate revision ≠ 0, candidate controller ≠ sender, or bad `roundId` rejected; same for `START_COMMITTED` state.
- Start-action envelopes must use bootstrap scope with envelope revision 0.
- `CONTROLLER_CHANGED` with missing/empty/oversized/invalid `electorate`, bad `roundId`, or state/controller/sender mismatch rejected; electorate array in the normalized value is a fresh copy.
- `ELECTION_ADVERTISE` without `roundId` rejected.
