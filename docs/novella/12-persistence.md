# 12 — Provisional persistence (checkpoints)

> **Revision 4 changes:** checkpoints are cleared when a session is **authoritatively ended** (`SESSION_ENDED` tombstone → `onSessionEnded`, 09); loaded checkpoints are validated **semantically against the currently bundled story** (04) before rendering; everything else (latest-session pointer, honest localforage typing, rejection handling) carries over from Revision 3.

## Storage layout

Adapter: `StorageContext.getPersistedStorage()` (localforage; `setItem` resolves to the stored value, not `void`). Two keys per room scope:

```text
visual-novel:v1:<roomScope>:latest        → sessionId (pointer)
visual-novel:v1:<roomScope>:<sessionId>   → checkpoint state (truncated form)
```

Without the pointer, a cold-started browser cannot know which session ID to load.

## `src/hooks/useVisualNovelCheckpoint.ts`

```ts
import { useEffect, useState } from 'react'
import type { VisualNovelSessionState } from 'models/visualNovel'
import {
  toSnapshotState,
  validateSessionAgainstStory,
  validateSessionState,
} from 'services/visualNovel'
import { getBundledStory } from 'stories/catalog'

// Matches localforage structurally: setItem resolves to the stored value.
interface StorageAdapter {
  getItem: (key: string) => Promise<unknown>
  setItem: (key: string, value: unknown) => Promise<unknown>
  removeItem: (key: string) => Promise<void>
}

const checkpointKey = (roomScope: string, sessionId: string) =>
  `visual-novel:v1:${roomScope}:${sessionId}`
const latestKey = (roomScope: string) =>
  `visual-novel:v1:${roomScope}:latest`

export const useVisualNovelCheckpoint = ({
  storage,
  roomScope,
  state,
}: {
  storage: StorageAdapter
  roomScope: string
  state: VisualNovelSessionState | null
}) => {
  const [provisional, setProvisional] = useState<VisualNovelSessionState | null>(null)

  useEffect(() => {
    if (!state) return
    // Truncated form so a loaded checkpoint always passes validateSessionState.
    // Storage failures (quota, IndexedDB) degrade to "no checkpoint".
    void Promise.all([
      storage.setItem(checkpointKey(roomScope, state.sessionId), toSnapshotState(state)),
      storage.setItem(latestKey(roomScope), state.sessionId),
    ]).catch(() => console.warn('Novella checkpoint write failed'))
  }, [roomScope, state, storage])

  // Cold start: discover the last session via the pointer, then load and
  // validate it structurally (03) AND semantically against the currently
  // bundled story (04) — a story updated between visits invalidates the
  // checkpoint instead of throwing at render time.
  const loadLatest = async (): Promise<VisualNovelSessionState | null> => {
    try {
      const sessionId = await storage.getItem(latestKey(roomScope))
      if (typeof sessionId !== 'string') return null
      const raw = await storage.getItem(checkpointKey(roomScope, sessionId))
      const structural = validateSessionState(raw)
      if (!structural.ok) return null
      const story = getBundledStory(
        structural.value.storyId, structural.value.storyVersion)
      if (!story) return null // story no longer bundled
      const semantic = validateSessionAgainstStory(structural.value, story)
      if (!semantic.ok) return null
      setProvisional(structural.value)
      return structural.value
    } catch {
      return null
    }
  }

  const acceptCanonical = (canonical: VisualNovelSessionState) => {
    // A local checkpoint never overrides canonical peer state, regardless of
    // its revision. It is provisional UI continuity only.
    setProvisional(null)
    return canonical
  }

  // Called from onSessionEnded (09) and from "Reset local novella data".
  const clear = async (sessionId: string) => {
    try {
      await storage.removeItem(checkpointKey(roomScope, sessionId))
      const latest = await storage.getItem(latestKey(roomScope))
      if (latest === sessionId) await storage.removeItem(latestKey(roomScope))
    } catch {
      console.warn('Novella checkpoint clear failed')
    }
    setProvisional(null)
  }

  return { provisional, loadLatest, acceptCanonical, clear }
}
```

## Rules

- The provisional state renders read-only continuity while a bootstrap `STATE_REQUEST` is outstanding; the first authorized snapshot or `SESSION_STARTED` replaces it via `acceptCanonical`.
- **Authoritative session end clears persistence:** `onSessionEnded(sessionId)` (09) must call `clear(sessionId)` — a tombstoned session cannot be resurrected from disk on the next visit.
- If the room has moved to a different session, `clear` the stale checkpoint after adopting the canonical one.
- Derive `roomScope` with a one-way digest of the room identifier if the storage key is inspectable.
- Never store the room password, invite URL, crypto keys, transport SDP, peer metadata, or chat messages in the checkpoint.
- A checkpoint can never become controller authority merely because it has a higher local revision.
- Provide "Reset local novella data" in story settings.

## Optional custom story packages after MVP

If added later: reuse the existing file-transfer service for a bounded archive, validate every archive path/type/size, assign a content digest, and require exact digest/version agreement before starting. Never put archive bytes in action envelopes; never make custom transfer part of MVP acceptance.
