# 05 — Pure visual-novel engine

> **Revision 7 changes:** removes the last claim that validated stories can never hit a runtime numeric guard. The load-bearing guarantee is that the engine refuses an illegal transition before mutation, so it never emits an untransmittable canonical state.

## Responsibilities

`VisualNovelEngine` owns deterministic story transitions. It receives a normalized manifest, an explicit clock, and immutable session state. It imports no React, storage, transport, DOM, random, or global time dependency.

Required API:

```ts
class VisualNovelEngine {
  constructor(
    story: VisualNovelManifest,
    dependencies: { now: () => number },
  )

  start(
    sessionId: string,
    controllerPeerId: string,
    sessionEpoch: number,
  ): VisualNovelSessionState

  getScene(state: VisualNovelSessionState): VisualNovelScene
  getEntry(state: VisualNovelSessionState): VisualNovelDialogueEntry
  getAvailableChoices(state: VisualNovelSessionState): VisualNovelChoice[]
  canAdvance(state: VisualNovelSessionState): boolean
  advance(state: VisualNovelSessionState): VisualNovelSessionState
  choose(state: VisualNovelSessionState, choiceId: string): VisualNovelSessionState
  restart(state: VisualNovelSessionState): VisualNovelSessionState
  changeController(
    state: VisualNovelSessionState,
    controllerPeerId: string,
  ): VisualNovelSessionState
}
```

## Transition invariants

- `start` creates revision 0 and preserves the supplied epoch/controller.
- `advance`, `choose`, `restart`, and `changeController` produce exactly `revision + 1`.
- input state and manifest are never mutated;
- history records the previous location and is bounded in memory;
- a choice entry with no currently available choice is `CHOICE_DEAD_END`, not an implicit advance;
- story mismatch, missing scene/entry, invalid choice, and end-of-branch use typed engine errors.

## Effects and transport limits

```ts
private applyEffect(
  variables: Record<string, VisualNovelValue>,
  effect: VisualNovelEffect,
): Record<string, VisualNovelValue> {
  if (effect.type === 'set') {
    return { ...variables, [effect.variable]: effect.value }
  }

  const current = variables[effect.variable]
  if (current !== undefined && typeof current !== 'number') {
    throw new VisualNovelEngineError(
      'INVALID_INCREMENT', 'Increment target is not numeric')
  }
  const result = (current ?? 0) + effect.amount
  if (!Number.isFinite(result)) {
    throw new VisualNovelEngineError(
      'INVALID_INCREMENT', 'Increment result is not finite')
  }
  return { ...variables, [effect.variable]: result }
}
```

Before committing a choice result:

```ts
private assertVariablesWithinLimits(
  variables: Record<string, VisualNovelValue>,
) {
  if (Object.keys(variables).length > visualNovelLimits.maxVariables ||
      utf8Bytes(variables) > visualNovelLimits.maxVariablesBytes) {
    throw new VisualNovelEngineError(
      'VARIABLES_LIMIT', 'Variables exceed the transport budget')
  }
}
```

The check occurs before `commit`, so a refused transition leaves the controller on its prior transmissible state. Runtime refusal may still happen for a looped increment; it is surfaced to the initiating user and is not broadcast.

## Replay

Replicas call the same engine method for `ADVANCED` and `CHOICE_RESOLVED`, then compare scene, entry, choice result, and variables with the canonical delta. Mismatch starts exact-target recovery rather than applying the event.

## Tests

- deterministic equality from identical input/clock;
- input and manifest immutability;
- start/advance/choice/restart/controller revisions and epochs;
- all branch endings and dead ends;
- effects, conditions, unavailable choices;
- variable count/byte refusal leaves input unchanged;
- non-finite and non-numeric increment refusal;
- every emitted snapshot form passes structural and semantic validation.
