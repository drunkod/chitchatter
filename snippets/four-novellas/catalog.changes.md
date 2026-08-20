# Target: src/stories/catalog.ts — register the three new stories

Copy the story folders first:

```
snippets/four-novellas/stories/masquerade/story.json     → src/stories/masquerade/story.json
snippets/four-novellas/stories/signal-static/story.json  → src/stories/signal-static/story.json
snippets/four-novellas/stories/ink-echo/story.json       → src/stories/ink-echo/story.json
```

Then two edits in `src/stories/catalog.ts`:

## Edit 1 — imports

```ts
import harbourLightsData from './harbour-lights/story.json'
import masqueradeData from './masquerade/story.json'
import signalStaticData from './signal-static/story.json'
import inkEchoData from './ink-echo/story.json'
```

## Edit 2 — the cache list

```ts
// Before:
bundledStoriesCache = [loadBundledStory(harbourLightsData)]

// After:
bundledStoriesCache = [
  loadBundledStory(harbourLightsData),
  loadBundledStory(masqueradeData),
  loadBundledStory(signalStaticData),
  loadBundledStory(inkEchoData),
]
```

Note: `getBundledStories()[0]` remains harbour-lights, so the classic
(non-duet) VisualNovelRoom and the E2E suite keep their current story.
All stories pass the same `validateStory` schema as harbour-lights.
