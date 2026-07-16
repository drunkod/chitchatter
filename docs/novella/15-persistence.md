# 15 — Persistence: checkpoints and room safety metadata

> **Revision 6 changes:** a third storage record, **`RoomMeta`** — the epoch high-water mark, session tombstones, and retained end notices. This is **protocol safety data, not story content**: checkpoints are deletable UI continuity, but if epochs and tombstones live only in memory, a full-room reload resets `latestEpoch` to 0, makes a lagging peer's old epoch-5 state "newer" than the next epoch-1 start, and forgets ended sessions entirely. `RoomMeta` survives checkpoint deletion and is loaded before the sync service processes any envelope (08/13). The checkpoint hook also tolerates the now-async `roomScope` (null until the digest resolves, 13).

## Integration contract (implemented in 13)

| Obligation | Where |
| --- | --- |
| Acquire `getPersistedStorage()` from `StorageContext` | `useVisualNovel` |
| Resolve `roomScope` **asynchronously** (`crypto.subtle` digest) and hold work until it exists | `useVisualNovel` effect (13) |
| **Load `RoomMeta` and construct the sync service from it** | same effect, before any envelope is processed (08) |
| Call `loadLatest()` after the scope resolves; mark persistence settled | `useVisualNovel` effect |
| Render provisional state **read-only**; block fresh starts until settled or explicitly discarded (`discardProvisional`) | `VisualNovel` / `canStartStory` (13) |
| Call `acceptCanonical()` when canonical state installs | `setState` wrapper in `useVisualNovel` |
| Call `clear(sessionId)` on authoritative end | `onSessionEnded` (11 → 13) |
| Call `clear(sessionId)` on stale-session replacement (switch, adoption, commit of a new epoch) | `setState` wrapper in `useVisualNovel` |
| Write-through `RoomMeta` on every epoch/tombstone change | `onMetaChange` (08) |

## Storage layout

Adapter: localforage (`setItem` resolves to the stored value, not `void`). Three keys per room scope:

```text
visual-novel:v1:<roomScope>:meta          → RoomMeta (SAFETY: epochs, tombstones,
                                            retained end notices — see 02/08)
visual-novel:v1:<roomScope>:latest        → sessionId (pointer)
visual-novel:v1:<roomScope>:<sessionId>   → checkpoint state (truncated form)
```

Without the pointer, a cold-started browser cannot know which session ID to load. Without the meta record, it cannot know which epochs are already decided or which sessions are already ended.

## Room meta lifecycle

- **Load:** in the same effect that resolves `roomScope` (13), before the sync service is constructed — `new VisualNovelSyncService(meta, onMetaChange)` (08). A missing/corrupt record degrades to `{ highWaterEpoch: 0, endedSessions: [] }` with a console warning (safety still holds for the sessions this browser never knew about; peers with intact meta re-teach it via the gate and retained notices).
- **Write-through:** every `noteEpoch` and `tombstone` persists the updated record (`onMetaChange` → `storage.setItem(metaKey, meta)`, rejection-tolerant like all other writes).
- **Bound:** `endedSessions` keeps the most recent `maxPersistedTombstones` (01); `highWaterEpoch` is a single integer and never trimmed.
- **"Reset local novella data"** clears checkpoints *and* meta — with a confirmation noting that resetting meta can transiently resurface an ended session until a peer with intact meta replies with the retained end notice.
- Each entry retains its `endEnvelope` so stale or reloaded peers can be answered after finalization (11).

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

  // Cold start: discover the last session via the pointer, then validate it
  // structurally (03) AND semantically against the currently bundled story
  // (04) — a story updated between visits invalidates the checkpoint instead
  // of throwing at render time.
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
    // its epoch or revision. It is provisional UI continuity only.
    setProvisional(null)
    return canonical
  }

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

- The provisional state renders read-only continuity while a bootstrap `STATE_REQUEST` is outstanding; the first authorized canonical state replaces it via `acceptCanonical`.
- **Authoritative session end clears persistence** (11 → `onSessionEnded` → `clear`); a tombstoned session cannot resurrect from disk on the next visit. The loaded checkpoint's `sessionEpoch` also passes through the pre-dispatch gate logic on the sync side: if the room has moved to a higher epoch, canonical traffic replaces the provisional view immediately and the stale checkpoint is cleared.
- Story switch and election adoption of a new session clear the replaced session's checkpoint (13 `setState` wrapper).
- Derive `roomScope` with a one-way digest; never store the room password, invite URL, crypto keys, transport SDP, peer metadata, or chat messages.
- A checkpoint can never become controller authority.
- Provide "Reset local novella data" in story settings.

## Optional custom story packages after MVP

If added later: reuse the existing file-transfer service for a bounded archive, validate every archive path/type/size, assign a content digest, and require exact digest/version agreement before starting. Never put archive bytes in action envelopes; never make custom transfer part of MVP acceptance.
