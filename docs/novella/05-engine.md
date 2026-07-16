# 05 — Pure engine

> **Revision 4 changes:** none functional — the engine is stable since Revision 3. Its determinism and immutability are load-bearing protocol properties: replicas replay canonical deltas through it (09), and semantic session validation (04) guarantees `getScene`/`getEntry` cannot throw on replicated state.

The engine owns legal story transitions. It receives a validated manifest, explicit dependencies, and an immutable session. It never imports React, storage, WebRTC, DOM APIs, or global time/randomness.

## `src/services/visualNovel/VisualNovelEngine.ts`

```ts
import { visualNovelLimits, visualNovelProtocolVersion } from 'config/visualNovel'
import type {
  VisualNovelChoice,
  VisualNovelCondition,
  VisualNovelDialogueEntry,
  VisualNovelEffect,
  VisualNovelManifest,
  VisualNovelScene,
  VisualNovelSessionState,
  VisualNovelValue,
} from 'models/visualNovel'

export class VisualNovelEngineError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'VisualNovelEngineError'
  }
}

export interface VisualNovelEngineDependencies {
  now: () => number
}

export class VisualNovelEngine {
  constructor(
    private readonly story: VisualNovelManifest,
    private readonly dependencies: VisualNovelEngineDependencies
  ) {}

  start(sessionId: string, controllerPeerId: string): VisualNovelSessionState {
    const scene = this.requireScene(this.story.startSceneId)
    const entry = scene.dialogue[0]
    if (!entry) throw new VisualNovelEngineError('EMPTY_START_SCENE', 'Start scene has no dialogue')

    return {
      protocolVersion: visualNovelProtocolVersion,
      storyId: this.story.id,
      storyVersion: this.story.version,
      sessionId,
      sceneId: scene.id,
      dialogueEntryId: entry.id,
      variables: {},
      history: [],
      controllerPeerId,
      revision: 0,
      updatedAt: this.dependencies.now(),
    }
  }

  getScene(state: VisualNovelSessionState): VisualNovelScene {
    this.assertCompatible(state)
    return this.requireScene(state.sceneId)
  }

  getEntry(state: VisualNovelSessionState): VisualNovelDialogueEntry {
    this.assertCompatible(state)
    return this.requireEntry(state.sceneId, state.dialogueEntryId)
  }

  getAvailableChoices(state: VisualNovelSessionState): VisualNovelChoice[] {
    return (this.getEntry(state).choices ?? []).filter(choice =>
      (choice.conditions ?? []).every(condition =>
        this.evaluateCondition(state.variables, condition)
      )
    )
  }

  canAdvance(state: VisualNovelSessionState): boolean {
    const entry = this.getEntry(state)
    if (this.getAvailableChoices(state).length > 0) return false
    // An entry that declares choices but offers none is a dead end, not an
    // advance opportunity — advancing here would silently skip a designed
    // branch. validateStory warns about this at build time (04, rule 11).
    if ((entry.choices ?? []).length > 0) return false
    const scene = this.getScene(state)
    const currentIndex = scene.dialogue.findIndex(item => item.id === entry.id)
    return Boolean(entry.next?.sceneId || entry.next?.dialogueEntryId ||
      scene.dialogue[currentIndex + 1])
  }

  advance(state: VisualNovelSessionState): VisualNovelSessionState {
    const entry = this.getEntry(state)
    if (this.getAvailableChoices(state).length > 0) {
      throw new VisualNovelEngineError('CHOICE_REQUIRED', 'Resolve a choice before advancing')
    }
    if ((entry.choices ?? []).length > 0) {
      throw new VisualNovelEngineError('CHOICE_DEAD_END', 'All choices at this entry are unavailable')
    }

    const currentScene = this.getScene(state)
    const currentIndex = currentScene.dialogue.findIndex(item => item.id === entry.id)
    const targetScene = entry.next?.sceneId
      ? this.requireScene(entry.next.sceneId)
      : currentScene
    const targetEntry = entry.next?.dialogueEntryId
      ? this.requireEntry(targetScene.id, entry.next.dialogueEntryId)
      : entry.next?.sceneId
        ? targetScene.dialogue[0]
        : currentScene.dialogue[currentIndex + 1]

    if (!targetEntry) {
      throw new VisualNovelEngineError('STORY_ENDED', 'The current branch has ended')
    }
    return this.commit(state, targetScene.id, targetEntry.id)
  }

  choose(state: VisualNovelSessionState, choiceId: string): VisualNovelSessionState {
    const choice = this.getAvailableChoices(state).find(item => item.id === choiceId)
    if (!choice) {
      throw new VisualNovelEngineError('CHOICE_UNAVAILABLE', 'The choice is unavailable')
    }
    const nextScene = this.requireScene(choice.nextSceneId)
    const firstEntry = nextScene.dialogue[0]
    if (!firstEntry) throw new VisualNovelEngineError('EMPTY_TARGET_SCENE', 'Target scene is empty')

    const variables = (choice.effects ?? []).reduce(
      (current, effect) => this.applyEffect(current, effect),
      { ...state.variables }
    )
    return this.commit(state, nextScene.id, firstEntry.id, { choiceId, variables })
  }

  restart(state: VisualNovelSessionState): VisualNovelSessionState {
    this.assertCompatible(state)
    const initial = this.start(state.sessionId, state.controllerPeerId)
    return {
      ...initial,
      revision: state.revision + 1,
      updatedAt: this.dependencies.now(),
    }
  }

  changeController(
    state: VisualNovelSessionState,
    controllerPeerId: string
  ): VisualNovelSessionState {
    this.assertCompatible(state)
    return {
      ...state,
      controllerPeerId,
      revision: state.revision + 1,
      updatedAt: this.dependencies.now(),
    }
  }

  private commit(
    state: VisualNovelSessionState,
    sceneId: string,
    dialogueEntryId: string,
    options: {
      choiceId?: string
      variables?: Record<string, VisualNovelValue>
    } = {}
  ): VisualNovelSessionState {
    this.assertCompatible(state)
    const history = [
      ...state.history,
      {
        revision: state.revision,
        sceneId: state.sceneId,
        dialogueEntryId: state.dialogueEntryId,
        choiceId: options.choiceId,
      },
    ].slice(-visualNovelLimits.maxHistoryEntries)

    return {
      ...state,
      sceneId,
      dialogueEntryId,
      variables: options.variables ?? state.variables,
      history,
      revision: state.revision + 1,
      updatedAt: this.dependencies.now(),
    }
  }

  private assertCompatible(state: VisualNovelSessionState) {
    if (state.storyId !== this.story.id || state.storyVersion !== this.story.version) {
      throw new VisualNovelEngineError('STORY_MISMATCH', 'Session story is incompatible')
    }
  }

  private requireScene(sceneId: string): VisualNovelScene {
    const scene = this.story.scenes[sceneId]
    if (!scene) throw new VisualNovelEngineError('SCENE_NOT_FOUND', `Unknown scene: ${sceneId}`)
    return scene
  }

  private requireEntry(sceneId: string, entryId: string): VisualNovelDialogueEntry {
    const entry = this.requireScene(sceneId).dialogue.find(item => item.id === entryId)
    if (!entry) throw new VisualNovelEngineError('ENTRY_NOT_FOUND', `Unknown entry: ${entryId}`)
    return entry
  }

  private evaluateCondition(
    variables: Record<string, VisualNovelValue>,
    condition: VisualNovelCondition
  ): boolean {
    const actual = variables[condition.variable]
    switch (condition.operator) {
      case 'eq': return actual === condition.value
      case 'neq': return actual !== condition.value
      case 'gt': return typeof actual === 'number' && typeof condition.value === 'number' && actual > condition.value
      case 'gte': return typeof actual === 'number' && typeof condition.value === 'number' && actual >= condition.value
      case 'lt': return typeof actual === 'number' && typeof condition.value === 'number' && actual < condition.value
      case 'lte': return typeof actual === 'number' && typeof condition.value === 'number' && actual <= condition.value
    }
  }

  private applyEffect(
    variables: Record<string, VisualNovelValue>,
    effect: VisualNovelEffect
  ): Record<string, VisualNovelValue> {
    if (effect.type === 'set') return { ...variables, [effect.variable]: effect.value }
    const current = variables[effect.variable]
    if (current !== undefined && typeof current !== 'number') {
      throw new VisualNovelEngineError('INVALID_INCREMENT', 'Increment target is not numeric')
    }
    return { ...variables, [effect.variable]: (current ?? 0) + effect.amount }
  }
}
```

## Engine tests

Use a fake clock so revisions/timestamps are deterministic:

```ts
import storyData from 'stories/example-story/story.json'
import { VisualNovelEngine } from './VisualNovelEngine'

const story = storyData as VisualNovelManifest
const makeEngine = () => new VisualNovelEngine(story, { now: () => 1000 })

it('starts and reaches the beacon ending', () => {
  const engine = makeEngine()
  const start = engine.start('session-1', 'peer-a')
  const atChoice = engine.advance(start)
  const ending = engine.choose(atChoice, 'light-beacon')
  expect(ending).toMatchObject({
    sceneId: 'beacon-ending',
    dialogueEntryId: 'beacon-1',
    variables: { usedBeacon: true, courage: 1 },
    revision: 2,
  })
})

it('restarts without changing session/controller', () => {
  const engine = makeEngine()
  const progressed = engine.advance(engine.start('session-1', 'peer-a'))
  expect(engine.restart(progressed)).toMatchObject({
    sessionId: 'session-1',
    controllerPeerId: 'peer-a',
    sceneId: 'pier',
    dialogueEntryId: 'pier-1',
    revision: 2,
  })
})

it('treats all-unavailable choices as a dead end, not a skip', () => {
  const gated = new VisualNovelEngine(gatedStory, { now: () => 1000 })
  const state = gated.start('session-1', 'peer-a')
  expect(gated.canAdvance(state)).toBe(false)
  expect(() => gated.advance(state)).toThrow('unavailable')
})

it('is deterministic and immutable', () => {
  const engine = makeEngine()
  const start = engine.start('session-1', 'peer-a')
  const frozen = JSON.parse(JSON.stringify(start))
  const a = engine.advance(start)
  const b = engine.advance(start)
  expect(a).toEqual(b)              // determinism: replay-safe (09)
  expect(start).toEqual(frozen)     // immutability: input untouched
})
```

Also test: unavailable choice, advancing at a choice, both endings, numeric effects, `INVALID_INCREMENT`, incompatible state (`STORY_MISMATCH`), missing scenes/entries, history bounding at `maxHistoryEntries`, `changeController`, end-of-branch `STORY_ENDED`, and that the manifest object is never mutated.
