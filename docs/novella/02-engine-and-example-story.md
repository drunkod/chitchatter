# 02 — Pure engine and bundled example story

> **Revision 2 changes:** explicit dead-end semantics — an entry that *declares* choices but has none available (all condition-gated off) is now a `CHOICE_DEAD_END` error instead of silently falling through to the next entry and erasing a designed branch. `restart` and snapshot emission use `toSnapshotState` history truncation at the sync layer (engine keeps full in-memory history).

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
    // branch. validateStory warns about this at build time (01, rule 12);
    // at runtime it is an authoring error surfaced to the controller.
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
      throw new VisualNovelEngineError(
        'CHOICE_DEAD_END',
        'All choices at this entry are unavailable'
      )
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

## `src/stories/example-story/story.json`

This complete story has three scenes, two visible characters, a background change, one branch, effects, and two endings.

```json
{
  "id": "harbour-lights",
  "version": "1.0.0",
  "title": "Harbour Lights",
  "description": "Two friends decide how to guide a boat home.",
  "startSceneId": "pier",
  "assets": {
    "pierNight": "stories/example-story/assets/pier-night.webp",
    "beaconNight": "stories/example-story/assets/beacon-night.webp",
    "harbourDawn": "stories/example-story/assets/harbour-dawn.webp",
    "maraConcerned": "stories/example-story/assets/mara-concerned.webp",
    "maraHappy": "stories/example-story/assets/mara-happy.webp",
    "solThinking": "stories/example-story/assets/sol-thinking.webp",
    "solHappy": "stories/example-story/assets/sol-happy.webp",
    "nightMusic": "stories/example-story/assets/night.ogg",
    "dawnMusic": "stories/example-story/assets/dawn.ogg",
    "beaconSound": "stories/example-story/assets/beacon.wav"
  },
  "scenes": {
    "pier": {
      "id": "pier",
      "background": "pierNight",
      "music": "nightMusic",
      "characters": [
        { "characterId": "mara", "sprite": "maraConcerned", "position": "left" },
        { "characterId": "sol", "sprite": "solThinking", "position": "right" }
      ],
      "dialogue": [
        {
          "id": "pier-1",
          "speaker": "Mara",
          "text": "The harbour beacon is dark, and the fishing boat is still outside the breakwater."
        },
        {
          "id": "pier-2",
          "speaker": "Sol",
          "text": "We have time for one signal. What should we do?",
          "choices": [
            {
              "id": "light-beacon",
              "label": "Light the old beacon",
              "nextSceneId": "beacon-ending",
              "effects": [
                { "type": "set", "variable": "usedBeacon", "value": true },
                { "type": "increment", "variable": "courage", "amount": 1 }
              ]
            },
            {
              "id": "wait-for-dawn",
              "label": "Wait together for dawn",
              "nextSceneId": "dawn-ending",
              "effects": [
                { "type": "set", "variable": "usedBeacon", "value": false },
                { "type": "increment", "variable": "patience", "amount": 1 }
              ]
            }
          ]
        }
      ]
    },
    "beacon-ending": {
      "id": "beacon-ending",
      "background": "beaconNight",
      "music": "nightMusic",
      "characters": [
        { "characterId": "mara", "sprite": "maraHappy", "position": "left" },
        { "characterId": "sol", "sprite": "solHappy", "position": "right" }
      ],
      "dialogue": [
        {
          "id": "beacon-1",
          "speaker": "Mara",
          "text": "The lens catches, then floods the water with gold.",
          "soundEffect": "beaconSound"
        },
        {
          "id": "beacon-2",
          "speaker": "Sol",
          "text": "The boat answers with two flashes. They found the channel."
        }
      ]
    },
    "dawn-ending": {
      "id": "dawn-ending",
      "background": "harbourDawn",
      "music": "dawnMusic",
      "characters": [
        { "characterId": "mara", "sprite": "maraHappy", "position": "left" },
        { "characterId": "sol", "sprite": "solHappy", "position": "right" }
      ],
      "dialogue": [
        {
          "id": "dawn-1",
          "speaker": "Sol",
          "text": "The first light draws a silver road across the water."
        },
        {
          "id": "dawn-2",
          "speaker": "Mara",
          "text": "Slowly, the boat follows it home."
        }
      ]
    }
  }
}
```

## `src/stories/catalog.ts`

```ts
import exampleStoryData from './example-story/story.json'
import type { VisualNovelManifest } from 'models/visualNovel'
import { validateStory } from 'services/visualNovel/VisualNovelValidator'

const loadBundledStory = (input: unknown): VisualNovelManifest => {
  const result = validateStory(input, window.location.origin)
  if (!result.ok) {
    throw new Error(`Invalid bundled story: ${result.errors.join(', ')}`)
  }
  return result.value
}

export const bundledStories = [loadBundledStory(exampleStoryData)]

export const getBundledStory = (storyId: string, storyVersion?: string) =>
  bundledStories.find(story =>
    story.id === storyId && (!storyVersion || story.version === storyVersion)
  ) ?? null
```

## `src/services/visualNovel/index.ts`

```ts
export * from './VisualNovelEngine'
export * from './VisualNovelSyncService'
export * from './VisualNovelValidator'
export * from './createVisualNovelEnvelope'
```

## Engine tests

Test with a fake clock so exact revisions/timestamps are deterministic:

```ts
import storyData from 'stories/example-story/story.json'
import { VisualNovelEngine } from './VisualNovelEngine'

const story = storyData as VisualNovelManifest
const engine = new VisualNovelEngine(story, { now: () => 1000 })

it('starts and reaches the beacon ending', () => {
  const start = engine.start('session-1', 'peer-a')
  const choice = engine.advance(start)
  const ending = engine.choose(choice, 'light-beacon')
  expect(ending).toMatchObject({
    sceneId: 'beacon-ending',
    dialogueEntryId: 'beacon-1',
    variables: { usedBeacon: true, courage: 1 },
    revision: 2,
  })
})

it('restarts without changing session/controller', () => {
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
  // Build a fixture whose only entry declares one choice gated behind an
  // impossible condition. advance must throw CHOICE_DEAD_END and canAdvance
  // must be false; the branch must never be silently skipped.
  const gated = new VisualNovelEngine(gatedStory, { now: () => 1000 })
  const state = gated.start('session-1', 'peer-a')
  expect(gated.canAdvance(state)).toBe(false)
  expect(() => gated.advance(state)).toThrow('unavailable')
})
```

Also test unavailable choices, attempts to advance at a choice, both endings, numeric effects, incompatible state, missing scenes/entries, history bounding, controller change, end-of-branch behavior, and immutability (input state and manifest are not mutated).
