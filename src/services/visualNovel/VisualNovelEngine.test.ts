import type { VisualNovelManifest } from '../../models/visualNovel'
import { getBundledStories } from '../../stories/catalog'
import { VisualNovelEngine, VisualNovelEngineError } from './VisualNovelEngine'

const story = getBundledStories()[0]
const createEngine = () => new VisualNovelEngine(story, { now: () => 1000 })

describe('VisualNovelEngine', () => {
  it('starts and reaches the beacon ending', () => {
    const engine = createEngine()
    const started = engine.start('session-1', 'peer-a')
    const choiceEntry = engine.advance(started)
    const ending = engine.choose(choiceEntry, 'light-beacon')

    expect(ending).toMatchObject({
      sceneId: 'beacon-ending',
      dialogueEntryId: 'beacon-1',
      variables: { route: 'beacon', usedBeacon: true, courage: 1 },
      revision: 2,
    })
    expect(started).toMatchObject({
      sceneId: 'pier',
      dialogueEntryId: 'pier-1',
      variables: {},
      history: [],
      revision: 0,
    })
  })

  it('reaches the dawn ending and detects the end of the branch', () => {
    const engine = createEngine()
    const started = engine.start('session-1', 'peer-a')
    const choiceEntry = engine.advance(started)
    const dawn = engine.choose(choiceEntry, 'wait-for-dawn')
    const finalEntry = engine.advance(dawn)

    expect(finalEntry.variables).toEqual({
      route: 'dawn',
      usedBeacon: false,
      patience: 1,
    })
    expect(engine.isAtEnd(finalEntry)).toBe(true)
    expect(engine.canAdvance(finalEntry)).toBe(false)
    expect(() => engine.advance(finalEntry)).toThrowError(
      expect.objectContaining({ code: 'STORY_ENDED' })
    )
  })

  it('restarts without changing the session or controller', () => {
    const engine = createEngine()
    const progressed = engine.advance(engine.start('session-1', 'peer-a'))
    const restarted = engine.restart(progressed)

    expect(restarted).toMatchObject({
      sessionId: 'session-1',
      controllerPeerId: 'peer-a',
      sceneId: 'pier',
      dialogueEntryId: 'pier-1',
      revision: 2,
    })
    expect(restarted.history).toEqual([])
  })

  it('changes controller without mutating the input state', () => {
    const engine = createEngine()
    const started = engine.start('session-1', 'peer-a')
    const changed = engine.changeController(started, 'peer-b')

    expect(changed.controllerPeerId).toBe('peer-b')
    expect(changed.revision).toBe(1)
    expect(started.controllerPeerId).toBe('peer-a')
    expect(started.revision).toBe(0)
  })

  it('exposes all-unavailable choices as a dead end', () => {
    const gatedStory: VisualNovelManifest = {
      id: 'gated',
      version: '1.0.0',
      title: 'Gated',
      startSceneId: 'only',
      scenes: {
        only: {
          id: 'only',
          dialogue: [
            {
              id: 'only-1',
              text: 'Choose.',
              choices: [
                {
                  id: 'locked',
                  label: 'Locked',
                  nextSceneId: 'only',
                  conditions: [
                    { variable: 'open', operator: 'eq', value: true },
                  ],
                },
              ],
            },
          ],
        },
      },
    }
    const engine = new VisualNovelEngine(gatedStory, { now: () => 1000 })
    const state = engine.start('session-1', 'peer-a')

    expect(engine.getAvailableChoices(state)).toEqual([])
    expect(engine.isChoiceDeadEnd(state)).toBe(true)
    expect(engine.isAtEnd(state)).toBe(false)
    expect(engine.canAdvance(state)).toBe(false)
    expect(() => engine.advance(state)).toThrowError(
      expect.objectContaining({ code: 'CHOICE_DEAD_END' })
    )
  })

  it('bounds history without mutating prior revisions', () => {
    const loopingStory: VisualNovelManifest = {
      id: 'looping',
      version: '1.0.0',
      title: 'Looping',
      startSceneId: 'loop',
      scenes: {
        loop: {
          id: 'loop',
          dialogue: [
            {
              id: 'loop-1',
              text: 'Again.',
              next: { dialogueEntryId: 'loop-1' },
            },
          ],
        },
      },
    }
    const engine = new VisualNovelEngine(loopingStory, { now: () => 1000 })
    const initial = engine.start('session-1', 'peer-a')
    let current = initial

    for (let index = 0; index < 300; index += 1) {
      current = engine.advance(current)
    }

    expect(current.history).toHaveLength(256)
    expect(current.history[0].revision).toBe(44)
    expect(initial.history).toEqual([])
  })

  it('rejects incompatible story state', () => {
    const engine = createEngine()
    const state = engine.start('session-1', 'peer-a')

    expect(() =>
      engine.getEntry({ ...state, storyId: 'another-story' })
    ).toThrowError(VisualNovelEngineError)
  })
})
