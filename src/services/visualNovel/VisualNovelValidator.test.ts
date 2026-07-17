import harbourLightsData from '../../stories/harbour-lights/story.json'
import {
  toSnapshotState,
  validateAssetPath,
  validateSessionState,
  validateStory,
} from './VisualNovelValidator'
import { VisualNovelEngine } from './VisualNovelEngine'

const origin = 'https://chitchatter.test'

describe('VisualNovelValidator', () => {
  it('normalizes the bundled story into a fresh trusted object', () => {
    const input = structuredClone(harbourLightsData)
    const result = validateStory(input, origin)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    input.scenes.pier.dialogue[0].text = 'mutated'
    expect(result.value.scenes.pier.dialogue[0].text).not.toBe('mutated')
    expect(result.warnings).toEqual([])
  })

  it('rejects unsafe assets and unknown choice targets', () => {
    expect(validateAssetPath('../outside.png', origin)).toMatchObject({
      ok: false,
    })

    const input = structuredClone(harbourLightsData)
    input.scenes.pier.dialogue[1].choices![0].nextSceneId = 'missing'
    const result = validateStory(input, origin)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toContain('Choice light-beacon targets unknown scene')
  })

  it('rejects malformed optional story fields instead of changing semantics', () => {
    const input = structuredClone(harbourLightsData) as unknown as Record<
      string,
      unknown
    >
    const scenes = input.scenes as Record<string, Record<string, unknown>>
    const pier = scenes.pier
    const dialogue = pier.dialogue as Record<string, unknown>[]
    dialogue[1].choices = {}
    dialogue[0].portrait = 42
    pier.characters = {}
    input.description = { invalid: true }

    const result = validateStory(input, origin)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'scenes.pier.dialogue[1].choices must be an array',
        'scenes.pier.dialogue[0].portrait is invalid',
        'scenes.pier.characters must be an array',
        'Invalid story.description',
      ])
    )
  })

  it('rejects duplicate dialogue identifiers', () => {
    const input = structuredClone(harbourLightsData)
    input.scenes['dawn-ending'].dialogue[0].id = 'pier-1'
    const result = validateStory(input, origin)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toContain('Duplicate dialogue id: pier-1')
  })

  it('does not add a scene-key mismatch error when a scene is malformed', () => {
    const input = structuredClone(harbourLightsData) as unknown as Record<
      string,
      unknown
    >
    const scenes = input.scenes as Record<string, unknown>
    scenes.pier = null

    const result = validateStory(input, origin)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toContain('scenes.pier is invalid')
    expect(result.errors).not.toContain(
      'Scene key pier does not match scene.id'
    )
  })

  it('validates and normalizes session state against its story', () => {
    const storyResult = validateStory(harbourLightsData, origin)
    expect(storyResult.ok).toBe(true)
    if (!storyResult.ok) return

    const engine = new VisualNovelEngine(storyResult.value, {
      now: () => 1000,
    })
    const state = engine.advance(engine.start('session-1', 'peer-a'))
    const result = validateSessionState(state, storyResult.value)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual(state)
    expect(result.value).not.toBe(state)
    expect(result.value.history).not.toBe(state.history)
  })

  it('rejects history at or above the current revision', () => {
    const storyResult = validateStory(harbourLightsData, origin)
    expect(storyResult.ok).toBe(true)
    if (!storyResult.ok) return

    const engine = new VisualNovelEngine(storyResult.value, {
      now: () => 1000,
    })
    const state = engine.advance(engine.start('session-1', 'peer-a'))
    const result = validateSessionState(
      {
        ...state,
        revision: 1,
        history: [{ ...state.history[0], revision: 9 }],
      },
      storyResult.value
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toContain(
      'State history revision must be below state.revision'
    )
  })

  it('rejects an unknown history choice', () => {
    const storyResult = validateStory(harbourLightsData, origin)
    expect(storyResult.ok).toBe(true)
    if (!storyResult.ok) return

    const engine = new VisualNovelEngine(storyResult.value, {
      now: () => 1000,
    })
    const state = engine.advance(engine.start('session-1', 'peer-a'))
    const result = validateSessionState(
      {
        ...state,
        revision: 2,
        history: [
          {
            revision: 1,
            sceneId: 'pier',
            dialogueEntryId: 'pier-2',
            choiceId: 'missing-choice',
          },
        ],
      },
      storyResult.value
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toContain(
      'State history references an unknown choice'
    )
  })

  it('creates a detached bounded snapshot', () => {
    const storyResult = validateStory(harbourLightsData, origin)
    expect(storyResult.ok).toBe(true)
    if (!storyResult.ok) return

    const engine = new VisualNovelEngine(storyResult.value, {
      now: () => 1000,
    })
    let state = engine.start('session-1', 'peer-a')
    for (let index = 0; index < 40; index += 1) {
      state = {
        ...state,
        revision: state.revision + 1,
        history: [
          ...state.history,
          {
            revision: state.revision,
            sceneId: state.sceneId,
            dialogueEntryId: state.dialogueEntryId,
          },
        ],
      }
    }

    const snapshot = toSnapshotState(state)
    expect(snapshot.history).toHaveLength(32)
    expect(snapshot.history).not.toBe(state.history)
    expect(snapshot.variables).not.toBe(state.variables)
  })
})
