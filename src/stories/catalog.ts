import type { VisualNovelManifest } from '../models/visualNovel'
import { validateStory } from '../services/visualNovel/VisualNovelValidator'
import harbourLightsData from './harbour-lights/story.json'

const applicationOrigin =
  typeof window === 'undefined'
    ? 'https://chitchatter.invalid'
    : window.location.origin

const loadBundledStory = (input: unknown): VisualNovelManifest => {
  const result = validateStory(input, applicationOrigin)
  if (!result.ok) {
    throw new Error(`Invalid bundled story: ${result.errors.join(', ')}`)
  }
  return result.value
}

let bundledStoriesCache: VisualNovelManifest[] | null = null

export const getBundledStories = (): VisualNovelManifest[] => {
  if (bundledStoriesCache !== null) return bundledStoriesCache

  try {
    bundledStoriesCache = [loadBundledStory(harbourLightsData)]
  } catch (error) {
    console.error(error)
    bundledStoriesCache = []
  }

  return bundledStoriesCache
}

export const getBundledStory = (storyId: string, storyVersion?: string) =>
  getBundledStories().find(
    story =>
      story.id === storyId &&
      (storyVersion === undefined || story.version === storyVersion)
  ) ?? null
