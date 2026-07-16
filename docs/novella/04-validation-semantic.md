# 04 — Semantic validation: stories and sessions against stories

> **Revision 5 changes:** story validation gains the **effect-reachable variable bound** (rule 13): the distinct variable names across all effects must not exceed `maxEffectVariables`, and the worst-case reachable variable map must fit `maxVariablesBytes`. Together with the engine's own limit enforcement (05) this closes the engine-vs-validator deadlock: a validated story cannot drive a controller into a transport-illegal state during normal play. `validateSessionAgainstStory` carries over from Revision 4 unchanged.

## `validateSessionAgainstStory`

Add to `src/services/visualNovel/VisualNovelValidator.ts`:

```ts
import type {
  VisualNovelManifest,
  VisualNovelSessionState,
} from 'models/visualNovel'

// Precondition: `state` already passed validateSessionState (03) and
// `manifest` already passed validateStory (below). Returns errors, not a
// value — the state is not transformed, only vetted against the story.
export const validateSessionAgainstStory = (
  state: VisualNovelSessionState,
  manifest: VisualNovelManifest
): ValidationResult<VisualNovelSessionState> => {
  const errors: string[] = []

  if (state.storyId !== manifest.id || state.storyVersion !== manifest.version) {
    return fail('State belongs to a different story/version')
  }

  const scene = manifest.scenes[state.sceneId]
  if (!scene) errors.push(`Unknown scene: ${state.sceneId}`)
  else if (!scene.dialogue.some(entry => entry.id === state.dialogueEntryId)) {
    errors.push(`Unknown dialogue entry: ${state.dialogueEntryId}`)
  }

  // History coherence: entries reference real scenes/entries/choices, and
  // revisions are strictly increasing and strictly below state.revision.
  let previousRevision = -1
  for (const entry of state.history) {
    const historyScene = manifest.scenes[entry.sceneId]
    if (!historyScene) { errors.push('History references unknown scene'); break }
    const historyEntry = historyScene.dialogue.find(item => item.id === entry.dialogueEntryId)
    if (!historyEntry) { errors.push('History references unknown entry'); break }
    if (entry.choiceId !== undefined &&
        !(historyEntry.choices ?? []).some(choice => choice.id === entry.choiceId)) {
      errors.push('History references unknown choice')
      break
    }
    if (entry.revision <= previousRevision) {
      errors.push('History revisions are not strictly increasing')
      break
    }
    previousRevision = entry.revision
  }
  if (state.history.length > 0 &&
      state.history[state.history.length - 1].revision >= state.revision) {
    errors.push('History revision not below state revision')
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: state }
}
```

## Call sites (mandatory)

Semantic validation runs at **every** point a full state enters the replica:

| Entry point | Doc | Rule |
| --- | --- | --- |
| `STATE_SNAPSHOT` / `SESSION_STARTED` / `RESTARTED` application | 12 | structural (03) → resolve story from the catalog (`getBundledStory(state.storyId, state.storyVersion)`) → **story must exist** → `validateSessionAgainstStory` → authorization (08) → apply |
| `START_PROPOSE` candidates at the coordinator / `START_COMMITTED` at every peer | 09 | same chain before collection/installation |
| `CONTROLLER_CHANGED` adopted state | 10/12 | same chain; the round rules (10) come after semantic validity |
| `ELECTION_ADVERTISE` collection at the winner | 10 | advertisements failing semantic validation are discarded, never adopted |
| Checkpoint load | 15 | a checkpoint that fails against the *currently bundled* story (e.g. story updated between visits) is discarded, not rendered |

A snapshot whose story is not in the local catalog is a **recoverable condition**, not an error loop: surface "story unavailable in this build" and stay in the lobby.

## `validateStory(input, applicationOrigin)`

Same file. Deep, normalizing (fresh object graph — same rule as 03), and the source of the manifest trusted by `validateSessionAgainstStory`:

1. Bound serialized story size via `utf8Bytes` before walking it.
2. Validate manifest `id`, semantic-looking `version`, `title`, optional `description`, `startSceneId`.
3. Bound the asset map and scene map (`maxScenes`, `maxDialogueEntriesPerScene`, `maxChoicesPerEntry`).
4. Validate each asset path with `validateAssetPath` (below).
5. Require `sceneMapKey === scene.id` and non-empty bounded dialogue.
6. Require unique dialogue IDs across the story and unique choice IDs.
7. Validate speaker/text/portrait/sound/background/music/character placement fields against the limits (01).
8. Ensure every asset key reference (`background`, `music`, `sprite`, `portrait`, `soundEffect`) exists in the asset map.
9. Ensure every `next.sceneId` and `choice.nextSceneId` exists; ensure `next.dialogueEntryId` exists in the effective target scene; ensure `startSceneId` exists and its scene has dialogue.
10. Accept only declared condition operators and effect types.
11. Warn (build-time) about entries whose choices can *all* be condition-gated off with no `next` fallback — the runtime `CHOICE_DEAD_END` (05) makes this an authoring error, never a silent skip.
12. Return a normalized fresh manifest; never the untrusted reference.
13. **Bound effect-reachable variables:** collect the distinct `variable` names across every effect in the story; reject if they exceed `maxEffectVariables`. Compute the worst-case reachable variable map (each `set` at its authored value size, each `increment` as a full-width finite number) and reject if its `utf8Bytes` exceeds `maxVariablesBytes`. This guarantees the engine's transport-limit enforcement (05) can never fire on a validated story in normal play.

## `validateAssetPath`

```ts
export const validateAssetPath = (
  path: unknown,
  applicationOrigin: string
): ValidationResult<string> => {
  if (!isString(path, 1024)) return fail('Invalid asset path')
  const value = path as string
  if (value.includes('..') || value.startsWith('//')) {
    return fail('Asset path escapes its story root')
  }
  try {
    const url = new URL(value, applicationOrigin)
    const extension = url.pathname.slice(url.pathname.lastIndexOf('.')).toLowerCase()
    if (url.origin !== applicationOrigin) return fail('Cross-origin story assets are disabled')
    if (!allowedVisualNovelAssetExtensions.has(extension)) return fail('Unsupported asset extension')
    return { ok: true, value }
  } catch {
    return fail('Malformed asset URL')
  }
}
```

## Tests for this step

- A structurally valid snapshot with a scene ID absent from the story is rejected by `validateSessionAgainstStory` — and a hook-level test asserts such a snapshot **never reaches `setState`** (no render-time engine throw).
- Unknown dialogue entry in a known scene; unknown scene/entry/choice inside history; non-increasing history revisions; last history revision ≥ state revision.
- Snapshot for a story/version not in the catalog → recoverable "story unavailable", no state change, no error loop.
- Checkpoint that no longer matches the bundled story is discarded on load.
- Story validation: all rules 1–13, including the dead-end authoring warning, asset-path traversal/cross-origin/extension rejections, and the effect-reachable variable bound (a story with 200 distinct effect variables, or with reachable worst-case variables exceeding `maxVariablesBytes`, is rejected at load).
- Normalization: mutating the input story object after `validateStory` does not affect the returned manifest.
