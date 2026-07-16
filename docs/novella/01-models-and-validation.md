# 01 — Models, limits, and runtime validation

> **Revision 2 changes:** payload/envelope/state interfaces extend `Record<string, any>` (not `unknown`) so they satisfy Trystero's `DataPayload` constraint in `usePeerAction<T>` — this matches `UnsentMessage`, `TypingStatus`, and `UserMetadata` in the repository. Snapshot limits are now internally consistent: snapshots carry truncated history (`maxSnapshotHistoryEntries`), variable string values are bounded, and the byte limits are derived from worst-case field limits. A reserved bootstrap scope allows `STATE_REQUEST` before any state exists.

This phase creates the trust boundary. TypeScript types help authors, but every story file, checkpoint, and remote payload must still be validated at runtime.

## `src/config/visualNovel.ts`

```ts
export const visualNovelProtocolVersion = 1 as const

// Byte limits are derived from the field limits below. Worst case for a
// snapshot: 32 truncated history entries (~450 B each) + 128 variables
// (~420 B each) + identifiers ≈ 70 KB upper bound. maxEnvelopeBytes must
// exceed maxSnapshotBytes plus envelope overhead.
export const visualNovelLimits = {
  maxEnvelopeBytes: 96 * 1024,
  maxSnapshotBytes: 80 * 1024,
  maxHistoryEntries: 256, // in-memory only
  maxSnapshotHistoryEntries: 32, // what actually travels in snapshots
  maxVariables: 128,
  maxVariableValueLength: 256,
  maxScenes: 256,
  maxDialogueEntriesPerScene: 512,
  maxChoicesPerEntry: 16,
  maxIdLength: 128,
  maxLabelLength: 256,
  maxTextLength: 8 * 1024,
  maxSeenActionIds: 2048,
  requestTimeoutMs: 10_000,
} as const

// Reserved scope for STATE_REQUEST sent by a peer that has no session state
// yet (late join before any push arrives). See 03.
export const visualNovelBootstrapScope = {
  sessionId: 'bootstrap',
  storyId: 'bootstrap',
  storyVersion: '0.0.0',
} as const

export const allowedVisualNovelAssetExtensions = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.ogg',
  '.png',
  '.webp',
  '.wav',
])
```

## `src/models/visualNovel.ts`

```ts
// NOTE: interfaces that travel over usePeerAction extend Record<string, any>.
// Trystero's DataPayload is JSON-value based and is NOT satisfied by
// Record<string, unknown>. This matches the existing repository convention
// (UnsentMessage, TypingStatus, UserMetadata).

export type VisualNovelValue = string | number | boolean

export interface VisualNovelCharacterPlacement {
  characterId: string
  sprite: string
  position: 'left' | 'center' | 'right'
  expression?: string
}

export interface VisualNovelCondition {
  variable: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  value: VisualNovelValue
}

export type VisualNovelEffect =
  | { type: 'set'; variable: string; value: VisualNovelValue }
  | { type: 'increment'; variable: string; amount: number }

export interface VisualNovelChoice {
  id: string
  label: string
  nextSceneId: string
  conditions?: VisualNovelCondition[]
  effects?: VisualNovelEffect[]
}

export interface VisualNovelTransition {
  sceneId?: string
  dialogueEntryId?: string
}

export interface VisualNovelDialogueEntry {
  id: string
  speaker?: string
  text: string
  portrait?: string
  characterChanges?: VisualNovelCharacterPlacement[]
  soundEffect?: string
  next?: VisualNovelTransition
  choices?: VisualNovelChoice[]
}

export interface VisualNovelScene {
  id: string
  background?: string
  music?: string
  characters?: VisualNovelCharacterPlacement[]
  dialogue: VisualNovelDialogueEntry[]
}

export interface VisualNovelManifest {
  id: string
  version: string
  title: string
  description?: string
  startSceneId: string
  assets?: Record<string, string>
  scenes: Record<string, VisualNovelScene>
}

export interface VisualNovelHistoryEntry {
  revision: number
  sceneId: string
  dialogueEntryId: string
  choiceId?: string
}

export interface VisualNovelSessionState extends Record<string, any> {
  protocolVersion: 1
  storyId: string
  storyVersion: string
  sessionId: string
  sceneId: string
  dialogueEntryId: string
  variables: Record<string, VisualNovelValue>
  history: VisualNovelHistoryEntry[]
  controllerPeerId: string
  revision: number
  updatedAt: number
}

// Identifiers shared by every envelope; separated from full state so that
// envelopes (e.g. bootstrap STATE_REQUEST) can be built without one.
export interface VisualNovelScope {
  sessionId: string
  storyId: string
  storyVersion: string
}

export type VisualNovelActionType =
  | 'STATE_REQUEST'
  | 'STATE_SNAPSHOT'
  | 'ADVANCE_REQUEST'
  | 'ADVANCED'
  | 'CHOICE_REQUEST'
  | 'CHOICE_RESOLVED'
  | 'SESSION_STARTED'
  | 'CONTROL_REQUEST'
  | 'CONTROL_PASSED'
  | 'CONTROLLER_CHANGED'
  | 'RESTART_REQUEST'
  | 'RESTARTED'
  | 'ERROR'

export interface VisualNovelActionEnvelope<T = any>
  extends Record<string, any> {
  protocol: 'visual-novel'
  protocolVersion: 1
  actionId: string
  actionType: VisualNovelActionType
  sessionId: string
  storyId: string
  storyVersion: string
  senderPeerId: string
  revision: number
  timestamp: number
  payload: T
}

export type VisualNovelPayloadByAction = {
  STATE_REQUEST: { knownRevision: number }
  STATE_SNAPSHOT: { state: VisualNovelSessionState }
  ADVANCE_REQUEST: { expectedRevision: number }
  ADVANCED: { sceneId: string; dialogueEntryId: string }
  CHOICE_REQUEST: { choiceId: string; expectedRevision: number }
  CHOICE_RESOLVED: {
    choiceId: string
    sceneId: string
    dialogueEntryId: string
    variables: Record<string, VisualNovelValue>
  }
  SESSION_STARTED: { state: VisualNovelSessionState }
  CONTROL_REQUEST: Record<string, never>
  CONTROL_PASSED: { controllerPeerId: string }
  CONTROLLER_CHANGED: { controllerPeerId: string }
  RESTART_REQUEST: { expectedRevision: number }
  RESTARTED: { state: VisualNovelSessionState }
  ERROR: { code: string; requestActionId?: string }
}

export type EnvelopeFor<T extends VisualNovelActionType> =
  VisualNovelActionEnvelope<VisualNovelPayloadByAction[T]> & {
    actionType: T
  }
```

## Snapshot truncation helper

Add to `src/services/visualNovel/VisualNovelValidator.ts` (or a sibling module) and use it for **every** outgoing `STATE_SNAPSHOT`, `SESSION_STARTED`, and `RESTARTED` payload:

```ts
export const toSnapshotState = (
  state: VisualNovelSessionState
): VisualNovelSessionState => ({
  ...state,
  history: state.history.slice(-visualNovelLimits.maxSnapshotHistoryEntries),
})
```

Without this, a state that is legal by every field limit (256 history entries with long IDs) exceeds the snapshot byte limit and late joiners can never sync.

## `src/services/visualNovel/VisualNovelValidator.ts`

The following is a full dependency-free validation skeleton. Keep the public API stable even if the implementation later moves to a schema library.

```ts
import {
  allowedVisualNovelAssetExtensions,
  visualNovelLimits,
  visualNovelProtocolVersion,
} from 'config/visualNovel'
import type {
  VisualNovelActionEnvelope,
  VisualNovelActionType,
  VisualNovelManifest,
  VisualNovelSessionState,
  VisualNovelValue,
} from 'models/visualNovel'

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] }

const actionTypes = new Set<VisualNovelActionType>([
  'STATE_REQUEST', 'STATE_SNAPSHOT', 'ADVANCE_REQUEST', 'ADVANCED',
  'CHOICE_REQUEST', 'CHOICE_RESOLVED', 'SESSION_STARTED',
  'CONTROL_REQUEST', 'CONTROL_PASSED', 'CONTROLLER_CHANGED',
  'RESTART_REQUEST', 'RESTARTED', 'ERROR',
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

const utf8Bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength

export const validateAssetPath = (
  path: unknown,
  applicationOrigin: string
): ValidationResult<string> => {
  if (!isString(path, 1024)) return { ok: false, errors: ['Invalid asset path'] }
  const value = path as string
  if (value.includes('..') || value.startsWith('//')) {
    return { ok: false, errors: ['Asset path escapes its story root'] }
  }
  try {
    const url = new URL(value, applicationOrigin)
    const extension = url.pathname.slice(url.pathname.lastIndexOf('.')).toLowerCase()
    if (url.origin !== applicationOrigin) {
      return { ok: false, errors: ['Cross-origin story assets are disabled'] }
    }
    if (!allowedVisualNovelAssetExtensions.has(extension)) {
      return { ok: false, errors: ['Unsupported asset extension'] }
    }
    return { ok: true, value }
  } catch {
    return { ok: false, errors: ['Malformed asset URL'] }
  }
}

export const validateSessionState = (
  input: unknown
): ValidationResult<VisualNovelSessionState> => {
  const errors: string[] = []
  if (!isRecord(input)) return { ok: false, errors: ['State must be an object'] }
  if (input.protocolVersion !== visualNovelProtocolVersion) errors.push('Unsupported state protocol')
  for (const key of ['storyId', 'storyVersion', 'sessionId', 'sceneId',
    'dialogueEntryId', 'controllerPeerId'] as const) {
    if (!isId(input[key])) errors.push(`Invalid state.${key}`)
  }
  if (!isRevision(input.revision)) errors.push('Invalid state.revision')
  if (typeof input.updatedAt !== 'number' || !Number.isFinite(input.updatedAt)) {
    errors.push('Invalid state.updatedAt')
  }
  if (!isRecord(input.variables)) errors.push('Invalid state.variables')
  else {
    const entries = Object.entries(input.variables)
    if (entries.length > visualNovelLimits.maxVariables) errors.push('Too many variables')
    if (entries.some(([key, value]) => !isId(key) || !isValue(value))) {
      errors.push('Invalid variable')
    }
  }
  // Incoming (snapshot) states must satisfy the snapshot history bound.
  if (!Array.isArray(input.history) ||
      input.history.length > visualNovelLimits.maxSnapshotHistoryEntries) {
    errors.push('Invalid state.history')
  }
  if (utf8Bytes(input) > visualNovelLimits.maxSnapshotBytes) {
    errors.push('Snapshot is too large')
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: input as VisualNovelSessionState }
}

const validatePayload = (
  actionType: VisualNovelActionType,
  payload: unknown
): string[] => {
  if (!isRecord(payload)) return ['Payload must be an object']
  switch (actionType) {
    case 'STATE_REQUEST':
      return isRevision(payload.knownRevision) ? [] : ['Invalid knownRevision']
    case 'STATE_SNAPSHOT':
    case 'SESSION_STARTED':
    case 'RESTARTED': {
      const result = validateSessionState(payload.state)
      return result.ok ? [] : result.errors
    }
    case 'ADVANCE_REQUEST':
    case 'RESTART_REQUEST':
      return isRevision(payload.expectedRevision) ? [] : ['Invalid expectedRevision']
    case 'ADVANCED':
      return isId(payload.sceneId) && isId(payload.dialogueEntryId)
        ? [] : ['Invalid advanced target']
    case 'CHOICE_REQUEST':
      return isId(payload.choiceId) && isRevision(payload.expectedRevision)
        ? [] : ['Invalid choice request']
    case 'CHOICE_RESOLVED':
      return isId(payload.choiceId) && isId(payload.sceneId) &&
        isId(payload.dialogueEntryId) && isRecord(payload.variables)
        ? [] : ['Invalid choice result']
    case 'CONTROL_REQUEST':
      return Object.keys(payload).length === 0 ? [] : ['Control request must be empty']
    case 'CONTROL_PASSED':
    case 'CONTROLLER_CHANGED':
      return isId(payload.controllerPeerId) ? [] : ['Invalid controller peer']
    case 'ERROR':
      return isId(payload.code) ? [] : ['Invalid error code']
  }
}

export const validateEnvelope = (
  input: unknown
): ValidationResult<VisualNovelActionEnvelope> => {
  if (!isRecord(input)) return { ok: false, errors: ['Envelope must be an object'] }
  const errors: string[] = []
  if (utf8Bytes(input) > visualNovelLimits.maxEnvelopeBytes) errors.push('Envelope too large')
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
  if (typeof input.actionType === 'string' && actionTypes.has(input.actionType as VisualNovelActionType)) {
    errors.push(...validatePayload(input.actionType as VisualNovelActionType, input.payload))
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: input as VisualNovelActionEnvelope }
}
```

### Complete story-validation rules

Implement `validateStory(input, applicationOrigin)` in the same file with these checks:

1. Bound serialized story size before walking it.
2. Validate manifest `id`, semantic-looking `version`, title, description, and `startSceneId`.
3. Bound the asset and scene maps.
4. Validate each asset path with `validateAssetPath`.
5. Require `sceneMapKey === scene.id` and non-empty bounded dialogue.
6. Require unique dialogue IDs across the story and unique choice IDs.
7. Validate speaker/text/portrait/sound/background/music/character placement fields.
8. Ensure every asset key reference exists.
9. Ensure every `next.sceneId` and `choice.nextSceneId` exists.
10. Ensure `next.dialogueEntryId` exists in the effective target scene.
11. Accept only declared condition operators and effect types.
12. Warn (build-time) about entries whose choices can *all* be condition-gated off with no `next` fallback — that is an authoring dead end (see 02).
13. Normalize into a fresh object rather than returning the untrusted reference.

## Message-context identity check

Envelope validation cannot prove transport identity. Always perform this additional check after validation:

```ts
const validated = validateEnvelope(input)
if (!validated.ok) return

if (validated.value.senderPeerId !== messageContext.peerId) {
  console.warn('Rejected visual-novel sender identity mismatch')
  return
}
```

Do not log the room password, private URL, encryption key, full snapshot, or rejected raw payload.

## Tests to complete this phase

- Accept a complete valid story and envelope of every action type.
- Reject arrays/null/primitives where objects are required.
- Reject missing/duplicate IDs, nonexistent transitions, bad asset keys, path traversal, cross-origin assets, unsupported extensions, NaN/infinity, oversized histories/variables/variable values/envelopes, unknown actions/effects/operators, and unsupported versions.
- Assert `toSnapshotState` truncates to `maxSnapshotHistoryEntries` and that a maximal truncated state passes `validateSessionState` (byte limits are consistent by construction).
- Assert the transport peer ID mismatch is rejected before state changes.
- Assert a bootstrap-scoped `STATE_REQUEST` envelope passes `validateEnvelope`.
