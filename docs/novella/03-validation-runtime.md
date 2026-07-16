# 03 — Runtime structural validation (normalizing)

> **Revision 4 changes:** every validator that succeeds returns a **freshly constructed value** — `validateEnvelope` no longer performs `input as VisualNovelActionEnvelope`, which aliased the untrusted object graph and preserved extra properties in direct contradiction of the normalization guarantee. `validatePayload` now returns normalized payload values, and the envelope is rebuilt field by field. Aggregate byte budgets (`maxVariablesBytes`, `maxHistoryBytes`) are enforced with the shared non-throwing `utf8Bytes`. `toSnapshotState` enforces the history **byte** budget, not just the entry count.

Structural validation proves shape, bounds, and internal consistency, and yields a clean copy. It does **not** prove story-semantic consistency (04) or sender authority (08). All three gates run before any state mutation.

## `src/services/visualNovel/VisualNovelValidator.ts` — primitives

```ts
import {
  allowedVisualNovelAssetExtensions,
  visualNovelLimits,
  visualNovelProtocolVersion,
} from 'config/visualNovel'
import type {
  VisualNovelActionEnvelope,
  VisualNovelActionType,
  VisualNovelHistoryEntry,
  VisualNovelSessionState,
  VisualNovelValue,
} from 'models/visualNovel'

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] }

const fail = <T>(...errors: string[]): ValidationResult<T> => ({ ok: false, errors })

const actionTypes = new Set<VisualNovelActionType>([
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

const isValue = (value: unknown): value is VisualNovelValue =>
  (typeof value === 'string' &&
    value.length <= visualNovelLimits.maxVariableValueLength) ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value))

// Single size gate used EVERYWHERE bytes are measured. Never throws: cyclic
// or non-serializable input is simply "oversized".
export const utf8Bytes = (value: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}
```

## Collections: variables and history

Both enforce element rules **and** the aggregate byte budget from 01, and both return fresh objects.

```ts
// Shared by state.variables and CHOICE_RESOLVED.variables.
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
  // Aggregate bytes: character limits alone under-count escaped JSON
  // (control characters expand to 6 bytes — see 01).
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
// Deep-validates AND normalizes. No property of the untrusted input is
// aliased in the returned value; unknown properties do not survive.
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
```

## Snapshot truncation

Enforces **both** the entry count and the history byte budget:

```ts
export const toSnapshotState = (
  state: VisualNovelSessionState
): VisualNovelSessionState => {
  let history = state.history.slice(-visualNovelLimits.maxSnapshotHistoryEntries)
  while (history.length > 0 &&
         utf8Bytes(history) > visualNovelLimits.maxHistoryBytes) {
    history = history.slice(1) // drop oldest until within budget
  }
  return { ...state, history }
}
```

Used for every outgoing `STATE_SNAPSHOT`, `SESSION_STARTED`, `RESTARTED`, `ELECTION_ADVERTISE`, and `CONTROLLER_CHANGED` state.

## Payloads — normalized, per action

`validatePayload` returns the **normalized payload value**, not just errors, so the envelope can be rebuilt from clean parts:

```ts
const validatePayload = (
  actionType: VisualNovelActionType,
  payload: unknown
): ValidationResult<unknown> => {
  if (!isRecord(payload)) return fail('Payload must be an object')
  switch (actionType) {
    case 'STATE_REQUEST':
      return isRevision(payload.knownRevision)
        ? { ok: true, value: { knownRevision: payload.knownRevision } }
        : fail('Invalid knownRevision')

    case 'STATE_SNAPSHOT': {
      if (payload.requestActionId !== undefined && !isId(payload.requestActionId)) {
        return fail('Invalid requestActionId')
      }
      const state = validateSessionState(payload.state)
      if (!state.ok) return state
      return {
        ok: true,
        value: {
          state: state.value,
          ...(payload.requestActionId !== undefined
            ? { requestActionId: payload.requestActionId }
            : {}),
        },
      }
    }

    case 'SESSION_STARTED':
    case 'RESTARTED':
    case 'ELECTION_ADVERTISE': {
      const state = validateSessionState(payload.state)
      return state.ok ? { ok: true, value: { state: state.value } } : state
    }

    case 'CONTROLLER_CHANGED': {
      if (!isId(payload.departedControllerPeerId) || !isId(payload.controllerPeerId)) {
        return fail('Invalid controller change')
      }
      const state = validateSessionState(payload.state)
      if (!state.ok) return state
      if (state.value.controllerPeerId !== payload.controllerPeerId) {
        return fail('Controller change state/controller mismatch')
      }
      return {
        ok: true,
        value: {
          departedControllerPeerId: payload.departedControllerPeerId,
          controllerPeerId: payload.controllerPeerId,
          state: state.value,
        },
      }
    }

    case 'ADVANCE_REQUEST':
    case 'RESTART_REQUEST':
      return isRevision(payload.expectedRevision)
        ? { ok: true, value: { expectedRevision: payload.expectedRevision } }
        : fail('Invalid expectedRevision')

    case 'ADVANCED':
      return isId(payload.sceneId) && isId(payload.dialogueEntryId)
        ? { ok: true, value: { sceneId: payload.sceneId, dialogueEntryId: payload.dialogueEntryId } }
        : fail('Invalid advanced target')

    case 'CHOICE_REQUEST':
      return isId(payload.choiceId) && isRevision(payload.expectedRevision)
        ? { ok: true, value: { choiceId: payload.choiceId, expectedRevision: payload.expectedRevision } }
        : fail('Invalid choice request')

    case 'CHOICE_RESOLVED': {
      if (!isId(payload.choiceId) || !isId(payload.sceneId) ||
          !isId(payload.dialogueEntryId)) return fail('Invalid choice result')
      const variables = validateVariables(payload.variables)
      if (!variables.ok) return variables
      return {
        ok: true,
        value: {
          choiceId: payload.choiceId,
          sceneId: payload.sceneId,
          dialogueEntryId: payload.dialogueEntryId,
          variables: variables.value,
        },
      }
    }

    case 'SESSION_ENDED':
    case 'CONTROL_REQUEST':
      return Object.keys(payload).length === 0
        ? { ok: true, value: {} }
        : fail('Payload must be empty')

    case 'CONTROL_PASSED':
      return isId(payload.controllerPeerId)
        ? { ok: true, value: { controllerPeerId: payload.controllerPeerId } }
        : fail('Invalid controller peer')

    case 'ERROR':
      return isId(payload.code) &&
        (payload.requestActionId === undefined || isId(payload.requestActionId))
        ? {
            ok: true,
            value: {
              code: payload.code,
              ...(payload.requestActionId !== undefined
                ? { requestActionId: payload.requestActionId }
                : {}),
            },
          }
        : fail('Invalid error payload')
  }
}
```

## Envelope — rebuilt field by field

```ts
const stateCarryingActions = new Set<VisualNovelActionType>([
  'STATE_SNAPSHOT', 'SESSION_STARTED', 'RESTARTED', 'ELECTION_ADVERTISE',
  'CONTROLLER_CHANGED',
])

export const validateEnvelope = (
  input: unknown
): ValidationResult<VisualNovelActionEnvelope> => {
  if (!isRecord(input)) return fail('Envelope must be an object')
  if (utf8Bytes(input) > visualNovelLimits.maxEnvelopeBytes) return fail('Envelope too large')

  const errors: string[] = []
  if (input.protocol !== 'visual-novel') errors.push('Invalid protocol')
  if (input.protocolVersion !== visualNovelProtocolVersion) errors.push('Unsupported protocol')
  if (!isId(input.actionId)) errors.push('Invalid actionId')
  if (typeof input.actionType !== 'string' ||
      !actionTypes.has(input.actionType as VisualNovelActionType)) {
    errors.push('Invalid actionType')
  }
  for (const key of ['sessionId', 'storyId', 'storyVersion', 'senderPeerId'] as const) {
    if (!isId(input[key])) errors.push(`Invalid ${key}`)
  }
  if (!isRevision(input.revision)) errors.push('Invalid revision')
  if (typeof input.timestamp !== 'number' || !Number.isFinite(input.timestamp)) {
    errors.push('Invalid timestamp')
  }
  if (errors.length) return { ok: false, errors }

  const actionType = input.actionType as VisualNovelActionType
  const payload = validatePayload(actionType, input.payload)
  if (!payload.ok) return payload as ValidationResult<VisualNovelActionEnvelope>

  // Cross-checks between envelope fields and embedded state.
  if (stateCarryingActions.has(actionType)) {
    const state = (payload.value as { state: VisualNovelSessionState }).state
    if (input.sessionId !== state.sessionId) errors.push('Envelope/state sessionId mismatch')
    if (input.storyId !== state.storyId) errors.push('Envelope/state storyId mismatch')
    if (input.storyVersion !== state.storyVersion) errors.push('Envelope/state storyVersion mismatch')
    if (input.revision !== state.revision) errors.push('Envelope/state revision mismatch')
    if (actionType === 'SESSION_STARTED') {
      if (state.revision !== 0) errors.push('SESSION_STARTED must be revision 0')
      if (state.controllerPeerId !== input.senderPeerId) {
        errors.push('SESSION_STARTED controller must be the sender')
      }
    }
    if (actionType === 'CONTROLLER_CHANGED' &&
        state.controllerPeerId !== input.senderPeerId) {
      errors.push('CONTROLLER_CHANGED controller must be the sender')
    }
  }
  if (errors.length) return { ok: false, errors }

  // NORMALIZATION: construct a fresh envelope. Never `input as ...` — that
  // would alias untrusted nested objects and preserve extra properties.
  return {
    ok: true,
    value: {
      protocol: 'visual-novel',
      protocolVersion: visualNovelProtocolVersion,
      actionId: input.actionId as string,
      actionType,
      sessionId: input.sessionId as string,
      storyId: input.storyId as string,
      storyVersion: input.storyVersion as string,
      senderPeerId: input.senderPeerId as string,
      revision: input.revision as number,
      timestamp: input.timestamp as number,
      payload: payload.value,
      // `proof` (post-MVP hardening) is intentionally dropped in MVP.
    },
  }
}
```

## Message-context identity check

Envelope validation cannot prove transport identity. Always, after validation:

```ts
if (validated.value.senderPeerId !== messageContext.peerId) {
  console.warn('Rejected visual-novel sender identity mismatch')
  return
}
```

Do not log the room password, private URL, encryption key, full snapshot, or rejected raw payload.

## Tests for this step

- Every action type round-trips: valid input → normalized value deep-equals the semantic content, extra top-level/nested properties are gone, and mutating the original input afterward does not affect the returned value (**no aliasing** — assert on nested `payload.state.variables` too).
- Cyclic input at every level fails with 'too large', never throws.
- Aggregate byte budgets: 128 valid variables of 256 worst-case-encoding characters (`''`) are rejected by `validateVariables` even though every element passes; same for history vs `maxHistoryBytes`.
- `toSnapshotState` output always satisfies both `maxSnapshotHistoryEntries` and `maxHistoryBytes`; a maximal legal truncated state passes `validateSessionState` (byte consistency by construction — 01).
- Envelope/state cross-field mismatches rejected for all five state-carrying actions; `SESSION_STARTED` non-zero revision or controller ≠ sender rejected; `CONTROLLER_CHANGED` with `state.controllerPeerId ≠ payload.controllerPeerId` or ≠ sender rejected.
- Malformed history entries and malformed `CHOICE_RESOLVED` variables rejected (not just non-object shapes).
- Bootstrap-scoped `STATE_REQUEST` passes; transport identity mismatch rejected before state changes.
