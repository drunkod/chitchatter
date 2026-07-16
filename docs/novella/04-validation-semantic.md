# 04 — Semantic validation: stories and replicated sessions

> **Revision 7 changes:** adds start gossip and reconciliation entry points to the mandatory semantic-validation chain and keeps the numeric-loop guarantee narrowly stated.

## `validateSessionAgainstStory`

A structurally valid state is not safe to render until its story references are checked:

```ts
export const validateSessionAgainstStory = (
  state: VisualNovelSessionState,
  manifest: VisualNovelManifest,
): ValidationResult<VisualNovelSessionState> => {
  if (state.storyId !== manifest.id || state.storyVersion !== manifest.version) {
    return fail('State belongs to a different story/version')
  }

  const errors: string[] = []
  const scene = manifest.scenes[state.sceneId]
  if (!scene) errors.push(`Unknown scene: ${state.sceneId}`)
  else if (!scene.dialogue.some(entry => entry.id === state.dialogueEntryId)) {
    errors.push(`Unknown dialogue entry: ${state.dialogueEntryId}`)
  }

  let previousRevision = -1
  for (const item of state.history) {
    const historyScene = manifest.scenes[item.sceneId]
    const historyEntry = historyScene?.dialogue.find(entry =>
      entry.id === item.dialogueEntryId)
    if (!historyScene || !historyEntry) {
      errors.push('History references unknown scene or entry')
      break
    }
    if (item.choiceId !== undefined &&
        !(historyEntry.choices ?? []).some(choice => choice.id === item.choiceId)) {
      errors.push('History references unknown choice')
      break
    }
    if (item.revision <= previousRevision || item.revision >= state.revision) {
      errors.push('History revisions are incoherent')
      break
    }
    previousRevision = item.revision
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: state }
}
```

## Mandatory full-state entry points

Run structural normalization, resolve the exact bundled story/version, then semantic validation before authorization/application for:

- `STATE_SNAPSHOT`, `SESSION_STARTED`, and `RESTARTED`;
- `START_PROPOSE.candidate` at the coordinator;
- `START_COMMITTED.decision.state`;
- both `START_DECISION_GOSSIP.decision.state` and `.knownState`;
- `SESSION_RECONCILE.state`;
- `ELECTION_ADVERTISE.state` and `CONTROLLER_CHANGED.state`;
- persisted checkpoints and `RoomMeta.activeStartDecision.state`.

Unknown story/version is recoverable UI state, not a render-time engine exception.

## Story validation

`validateStory` is deep and normalizing. It must:

1. bound total encoded size;
2. validate manifest IDs/version/title/start scene;
3. bound scenes, dialogue entries, and choices;
4. validate same-origin asset paths and supported extensions;
5. require map keys to match IDs and IDs to be unique;
6. validate every transition, choice target, dialogue target, asset reference, condition, and effect;
7. warn when all choices can be gated off without a fallback;
8. return a fresh manifest;
9. bound distinct effect variable names and worst-case serialized value width.

Static analysis does **not** prove that a numeric increment inside an arbitrary cycle can execute forever without overflow. The engine checks each resulting value and refuses the one transition before mutation. This is an explicit authoring/runtime error, never an untransmittable canonical state.

## Tests

- unknown scene/entry/choice in live state or history;
- non-increasing or current/future history revisions;
- missing bundled story/version;
- every new full-state action is rejected before `setState` when semantic validation fails;
- story normalization is alias-free;
- effect variable count/byte limits and conservative cycle warnings.
