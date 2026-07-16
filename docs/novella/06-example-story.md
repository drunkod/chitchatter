# 06 — Bundled example story and catalog

> **Revision 4 changes:** none functional; the catalog note now points at the semantic validator (04) and the story-unavailable recovery path.

## `src/stories/example-story/story.json`

Three scenes, two visible characters, a background change, one branch, effects, and two endings.

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
  return result.value // normalized fresh manifest (04)
}

export const bundledStories = [loadBundledStory(exampleStoryData)]

export const getBundledStory = (storyId: string, storyVersion?: string) =>
  bundledStories.find(story =>
    story.id === storyId && (!storyVersion || story.version === storyVersion)
  ) ?? null
```

`getBundledStory` returning `null` for a replicated state's story/version is the **story-unavailable** recovery path (04): surface it, stay in the lobby, never loop.

## `src/services/visualNovel/index.ts`

```ts
export * from './VisualNovelEngine'
export * from './VisualNovelSyncService'
export * from './VisualNovelTransport'
export * from './VisualNovelValidator'
export * from './createVisualNovelEnvelope'
```
