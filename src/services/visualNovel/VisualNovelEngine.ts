import {
  visualNovelLimits,
  visualNovelProtocolVersion,
} from '../../config/visualNovel'
import type {
  VisualNovelChoice,
  VisualNovelCondition,
  VisualNovelDialogueEntry,
  VisualNovelEffect,
  VisualNovelManifest,
  VisualNovelScene,
  VisualNovelSessionState,
  VisualNovelValue,
} from '../../models/visualNovel'

export class VisualNovelEngineError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
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
    this.assertIdentifier(sessionId, 'sessionId')
    this.assertIdentifier(controllerPeerId, 'controllerPeerId')
    const scene = this.requireScene(this.story.startSceneId)
    const entry = scene.dialogue[0]

    if (!entry) {
      throw new VisualNovelEngineError(
        'EMPTY_START_SCENE',
        'Start scene has no dialogue'
      )
    }

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

  isChoiceDeadEnd(state: VisualNovelSessionState): boolean {
    const entry = this.getEntry(state)

    return (
      (entry.choices ?? []).length > 0 &&
      this.getAvailableChoices(state).length === 0
    )
  }

  canAdvance(state: VisualNovelSessionState): boolean {
    const entry = this.getEntry(state)

    if (this.getAvailableChoices(state).length > 0) return false
    if ((entry.choices ?? []).length > 0) return false

    const scene = this.getScene(state)
    const currentIndex = scene.dialogue.findIndex(item => item.id === entry.id)

    return Boolean(
      entry.next?.sceneId ||
        entry.next?.dialogueEntryId ||
        scene.dialogue[currentIndex + 1]
    )
  }

  isAtEnd(state: VisualNovelSessionState): boolean {
    const entry = this.getEntry(state)

    return (
      (entry.choices ?? []).length === 0 &&
      this.getAvailableChoices(state).length === 0 &&
      !this.canAdvance(state)
    )
  }

  advance(state: VisualNovelSessionState): VisualNovelSessionState {
    const entry = this.getEntry(state)

    if (this.getAvailableChoices(state).length > 0) {
      throw new VisualNovelEngineError(
        'CHOICE_REQUIRED',
        'Resolve a choice before advancing'
      )
    }
    if ((entry.choices ?? []).length > 0) {
      throw new VisualNovelEngineError(
        'CHOICE_DEAD_END',
        'All choices at this entry are unavailable'
      )
    }

    const currentScene = this.getScene(state)
    const currentIndex = currentScene.dialogue.findIndex(
      item => item.id === entry.id
    )
    const targetScene = entry.next?.sceneId
      ? this.requireScene(entry.next.sceneId)
      : currentScene
    const targetEntry = entry.next?.dialogueEntryId
      ? this.requireEntry(targetScene.id, entry.next.dialogueEntryId)
      : entry.next?.sceneId
        ? targetScene.dialogue[0]
        : currentScene.dialogue[currentIndex + 1]

    if (!targetEntry) {
      throw new VisualNovelEngineError(
        'STORY_ENDED',
        'The current branch has ended'
      )
    }

    return this.commit(state, targetScene.id, targetEntry.id)
  }

  choose(
    state: VisualNovelSessionState,
    choiceId: string
  ): VisualNovelSessionState {
    this.assertIdentifier(choiceId, 'choiceId')
    const choice = this.getAvailableChoices(state).find(
      item => item.id === choiceId
    )

    if (!choice) {
      throw new VisualNovelEngineError(
        'CHOICE_UNAVAILABLE',
        'The choice is unavailable'
      )
    }
    const nextScene = this.requireScene(choice.nextSceneId)
    const firstEntry = nextScene.dialogue[0]

    if (!firstEntry) {
      throw new VisualNovelEngineError(
        'EMPTY_TARGET_SCENE',
        'Target scene is empty'
      )
    }

    const variables = (choice.effects ?? []).reduce(
      (current, effect) => this.applyEffect(current, effect),
      { ...state.variables }
    )

    return this.commit(state, nextScene.id, firstEntry.id, {
      choiceId,
      variables,
    })
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
    this.assertIdentifier(controllerPeerId, 'controllerPeerId')
    return {
      ...state,
      variables: { ...state.variables },
      history: state.history.map(entry => ({ ...entry })),
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
    const variables = options.variables
      ? { ...options.variables }
      : { ...state.variables }

    this.assertVariables(variables)

    const history = [
      ...state.history.map(entry => ({ ...entry })),
      {
        revision: state.revision,
        sceneId: state.sceneId,
        dialogueEntryId: state.dialogueEntryId,
        ...(options.choiceId ? { choiceId: options.choiceId } : {}),
      },
    ].slice(-visualNovelLimits.maxHistoryEntries)

    return {
      ...state,
      sceneId,
      dialogueEntryId,
      variables,
      history,
      revision: state.revision + 1,
      updatedAt: this.dependencies.now(),
    }
  }

  private assertCompatible(state: VisualNovelSessionState) {
    if (
      state.protocolVersion !== visualNovelProtocolVersion ||
      state.storyId !== this.story.id ||
      state.storyVersion !== this.story.version
    ) {
      throw new VisualNovelEngineError(
        'STORY_MISMATCH',
        'Session story is incompatible'
      )
    }
    if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
      throw new VisualNovelEngineError(
        'INVALID_REVISION',
        'Session revision is invalid'
      )
    }
  }

  private assertVariables(variables: Record<string, VisualNovelValue>) {
    if (Object.keys(variables).length > visualNovelLimits.maxVariables) {
      throw new VisualNovelEngineError(
        'VARIABLE_LIMIT',
        'The story has too many variables'
      )
    }
    Object.entries(variables).forEach(([key, value]) => {
      this.assertIdentifier(key, 'variable')
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new VisualNovelEngineError(
          'INVALID_VARIABLE',
          'Story variables must be finite'
        )
      }
      if (
        typeof value === 'string' &&
        value.length > visualNovelLimits.maxVariableValueLength
      ) {
        throw new VisualNovelEngineError(
          'VARIABLE_LIMIT',
          'A story variable is too long'
        )
      }
    })
  }

  private assertIdentifier(value: string, field: string) {
    if (
      value.length === 0 ||
      value.length > visualNovelLimits.maxIdLength ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    ) {
      throw new VisualNovelEngineError(
        'INVALID_IDENTIFIER',
        `${field} is invalid`
      )
    }
  }

  private requireScene(sceneId: string): VisualNovelScene {
    const scene = this.story.scenes[sceneId]

    if (!scene) {
      throw new VisualNovelEngineError(
        'SCENE_NOT_FOUND',
        `Unknown scene: ${sceneId}`
      )
    }
    return scene
  }

  private requireEntry(
    sceneId: string,
    entryId: string
  ): VisualNovelDialogueEntry {
    const entry = this.requireScene(sceneId).dialogue.find(
      item => item.id === entryId
    )

    if (!entry) {
      throw new VisualNovelEngineError(
        'ENTRY_NOT_FOUND',
        `Unknown entry: ${entryId}`
      )
    }
    return entry
  }

  private evaluateCondition(
    variables: Record<string, VisualNovelValue>,
    condition: VisualNovelCondition
  ): boolean {
    const actual = variables[condition.variable]

    switch (condition.operator) {
      case 'eq':
        return actual === condition.value
      case 'neq':
        return actual !== condition.value
      case 'gt':
        return (
          typeof actual === 'number' &&
          typeof condition.value === 'number' &&
          actual > condition.value
        )
      case 'gte':
        return (
          typeof actual === 'number' &&
          typeof condition.value === 'number' &&
          actual >= condition.value
        )
      case 'lt':
        return (
          typeof actual === 'number' &&
          typeof condition.value === 'number' &&
          actual < condition.value
        )
      case 'lte':
        return (
          typeof actual === 'number' &&
          typeof condition.value === 'number' &&
          actual <= condition.value
        )
    }
  }

  private applyEffect(
    variables: Record<string, VisualNovelValue>,
    effect: VisualNovelEffect
  ): Record<string, VisualNovelValue> {
    if (effect.type === 'set') {
      return { ...variables, [effect.variable]: effect.value }
    }
    const current = variables[effect.variable]

    if (current !== undefined && typeof current !== 'number') {
      throw new VisualNovelEngineError(
        'INVALID_INCREMENT',
        'Increment target is not numeric'
      )
    }
    const value = (current ?? 0) + effect.amount

    if (!Number.isFinite(value)) {
      throw new VisualNovelEngineError(
        'INVALID_INCREMENT',
        'Increment result is not finite'
      )
    }
    return { ...variables, [effect.variable]: value }
  }
}
