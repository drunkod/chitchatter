import type { VisualNovelManifest } from '../models/visualNovel'
import { validateStory } from '../services/visualNovel/VisualNovelValidator'

import harbourLightsData from './harbour-lights/story.json'
import masqueradeData from './masquerade/story.json'
import signalStaticData from './signal-static/story.json'
import inkEchoData from './ink-echo/story.json'

const applicationOrigin =
  typeof window === 'undefined'
    ? 'https://chitchatter.invalid'
    : window.location.origin

const loadBundledStory = (input: unknown): VisualNovelManifest | null => {
  const result = validateStory(input, applicationOrigin)

  if (!result.ok) {
    console.error(`Invalid bundled story: ${result.errors.join(', ')}`)

    return null
  }

  return result.value
}

let bundledStoriesCache: VisualNovelManifest[] | null = null

export const getBundledStories = (): VisualNovelManifest[] => {
  if (bundledStoriesCache !== null) return bundledStoriesCache

  // NOTE: harbour-lights must stay first — classic mode and the E2E suite
  // rely on getBundledStories()[0].
  bundledStoriesCache = [
    harbourLightsData,
    masqueradeData,
    signalStaticData,
    inkEchoData,
  ]
    .map(loadBundledStory)
    .filter((story): story is VisualNovelManifest => story !== null)

  return bundledStoriesCache
}

export const getBundledStory = (storyId: string, storyVersion?: string) =>
  getBundledStories().find(
    story =>
      story.id === storyId &&
      (storyVersion === undefined || story.version === storyVersion)
  ) ?? null
