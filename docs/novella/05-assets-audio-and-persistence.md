# 05 — Assets, local story audio, and provisional persistence

> **Revision 3 changes:** the checkpoint store gains a room-scoped **latest-session pointer** so a cold-started browser can discover which checkpoint to load (previously `load(sessionId)` required an ID the browser could not know); the adapter type matches localforage honestly (`setItem` resolves to the stored value, so the adapter uses `Promise<unknown>`); all storage operations handle rejections (quota, IndexedDB failures) instead of producing unhandled promises. Asset-loading fixes from Revision 2 stand.

Story assets are bundled or statically hosted by the same application. Only state identifiers travel through the novella protocol.

## `src/hooks/useVisualNovelAssets.ts`

```ts
import { useEffect, useMemo, useState } from 'react'
import type { VisualNovelManifest, VisualNovelScene } from 'models/visualNovel'

type AssetStatus = 'idle' | 'loading' | 'ready' | 'partial-error'

const resolveAsset = (
  story: VisualNovelManifest,
  assetKey: string | undefined,
  applicationBase: string
) => {
  if (!assetKey) return null
  const path = story.assets?.[assetKey]
  if (!path) return null
  const url = new URL(path, applicationBase)
  if (url.origin !== new URL(applicationBase).origin) return null
  return url.href
}

const probableNextScenes = (
  story: VisualNovelManifest,
  scene: VisualNovelScene
) => {
  const ids = new Set<string>()
  for (const entry of scene.dialogue) {
    if (entry.next?.sceneId) ids.add(entry.next.sceneId)
    for (const choice of entry.choices ?? []) ids.add(choice.nextSceneId)
  }
  return [...ids].map(id => story.scenes[id]).filter(Boolean)
}

export const useVisualNovelAssets = (
  story: VisualNovelManifest | null,
  scene: VisualNovelScene | null
) => {
  const [status, setStatus] = useState<AssetStatus>('idle')
  const [failedUrls, setFailedUrls] = useState<string[]>([])
  const base = new URL(import.meta.env.BASE_URL, window.location.origin).href

  const urls = useMemo(() => {
    if (!story || !scene) return []
    const scenes = [scene, ...probableNextScenes(story, scene)]
    return [...new Set(scenes.flatMap(candidate => [
      resolveAsset(story, candidate.background, base),
      resolveAsset(story, candidate.music, base),
      ...(candidate.characters ?? []).map(character =>
        resolveAsset(story, character.sprite, base)),
      ...candidate.dialogue.flatMap(entry => [
        resolveAsset(story, entry.portrait, base),
        resolveAsset(story, entry.soundEffect, base),
        ...(entry.characterChanges ?? []).map(character =>
          resolveAsset(story, character.sprite, base)),
      ]),
    ]).filter((url): url is string => Boolean(url)))]
  }, [base, scene, story])

  useEffect(() => {
    let cancelled = false
    if (!urls.length) { setStatus('ready'); return }
    setStatus('loading')
    setFailedUrls([])

    // Collect failures locally — reading failedUrls state inside .then()
    // would observe a stale snapshot from this render.
    const failures: string[] = []

    void Promise.all(urls.map(async url => {
      const pathname = new URL(url).pathname.toLowerCase()
      const isImage = /\.(avif|gif|jpe?g|png|webp)$/.test(pathname)
      if (!isImage) return
      await new Promise<void>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve()
        image.onerror = () => reject(new Error(url))
        image.src = url
      })
    }).map(promise => promise.catch(error => {
      failures.push(String(error.message))
    }))).then(() => {
      if (cancelled) return
      setFailedUrls(failures)
      setStatus(failures.length ? 'partial-error' : 'ready')
    })

    return () => { cancelled = true }
  }, [urls])

  return {
    status,
    failedUrls,
    resolve: (assetKey?: string) => story
      ? resolveAsset(story, assetKey, base)
      : null,
  }
}
```

## Missing-asset behavior

- Background failure: use theme background color/gradient and retain dialogue.
- Character failure: omit the image and retain speaker name/text.
- Music/SFX failure: show a non-blocking muted indicator; never block state application.
- Do not retry indefinitely. One user-triggered retry is enough for MVP.
- Preload only current and probable next scenes, not an unbounded story.

## `src/hooks/useVisualNovelAudio.ts`

Story music and effects are local. They never use `PeerRoom.addStream` and never modify the existing microphone stream.

```ts
import { useCallback, useEffect, useRef, useState } from 'react'

export const useVisualNovelAudio = () => {
  const musicRef = useRef<HTMLAudioElement | null>(null)
  const [musicVolume, setMusicVolumeState] = useState(0.6)
  const [effectsVolume, setEffectsVolumeState] = useState(0.8)
  const [isAutoplayBlocked, setIsAutoplayBlocked] = useState(false)

  const stopMusic = useCallback(() => {
    const music = musicRef.current
    if (!music) return
    music.pause()
    music.currentTime = 0
    musicRef.current = null
  }, [])

  const playMusic = useCallback(async (url: string | null) => {
    // Note: HTMLAudioElement.src is absolutized by the browser — pass the
    // resolved absolute URL from useVisualNovelAssets so this compare works.
    if (musicRef.current?.src === url) return
    stopMusic()
    if (!url) return
    const audio = new Audio(url)
    audio.loop = true
    audio.preload = 'auto'
    audio.volume = musicVolume
    musicRef.current = audio
    try {
      await audio.play()
      setIsAutoplayBlocked(false)
    } catch {
      setIsAutoplayBlocked(true)
    }
  }, [musicVolume, stopMusic])

  const playEffect = useCallback(async (url: string | null) => {
    if (!url) return
    const audio = new Audio(url)
    audio.volume = effectsVolume
    try { await audio.play() }
    catch { setIsAutoplayBlocked(true) }
  }, [effectsVolume])

  const setMusicVolume = useCallback((value: number) => {
    const bounded = Math.max(0, Math.min(1, value))
    setMusicVolumeState(bounded)
    if (musicRef.current) musicRef.current.volume = bounded
  }, [])

  const setEffectsVolume = useCallback((value: number) => {
    setEffectsVolumeState(Math.max(0, Math.min(1, value)))
  }, [])

  const resumeAfterGesture = useCallback(async () => {
    try {
      await musicRef.current?.play()
      setIsAutoplayBlocked(false)
    } catch { setIsAutoplayBlocked(true) }
  }, [])

  useEffect(() => stopMusic, [stopMusic])

  return {
    musicVolume,
    effectsVolume,
    isAutoplayBlocked,
    setMusicVolume,
    setEffectsVolume,
    playMusic,
    playEffect,
    stopMusic,
    resumeAfterGesture,
  }
}
```

Trigger music when the canonical scene changes and SFX when the canonical dialogue entry changes. Duplicate action suppression prevents repeated effects from the same envelope; also key the effect by `sessionId/revision/dialogueEntryId` in React Strict Mode.

## Audio controls

```tsx
<Stack direction="row" spacing={2} aria-label="Story audio">
  <Slider
    aria-label="Story music volume"
    min={0}
    max={1}
    step={0.05}
    value={musicVolume}
    onChange={(_, value) => setMusicVolume(value as number)}
  />
  <Slider
    aria-label="Story sound effects volume"
    min={0}
    max={1}
    step={0.05}
    value={effectsVolume}
    onChange={(_, value) => setEffectsVolume(value as number)}
  />
</Stack>
```

These controls are separate from voice communication volume.

## `src/hooks/useVisualNovelCheckpoint.ts`

Use the repository's existing storage abstraction: `StorageContext.getPersistedStorage()` returns a localforage instance. Note localforage's `setItem` resolves to the **stored value**, not `void` — the adapter type reflects that. Two keys per room scope:

```text
visual-novel:v1:<roomScope>:latest        → sessionId (pointer)
visual-novel:v1:<roomScope>:<sessionId>   → checkpoint state
```

Without the pointer, a cold-started browser cannot know which session ID to load, and the checkpoint provides no continuity until canonical state has already arrived.

```ts
import { useEffect, useState } from 'react'
import type { VisualNovelSessionState } from 'models/visualNovel'
import { validateSessionState, toSnapshotState } from 'services/visualNovel'

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
    // Store the truncated form so a loaded checkpoint always passes
    // validateSessionState (which enforces the snapshot history bound).
    // Quota/IndexedDB failures degrade to "no checkpoint", never throw up
    // the render path.
    void Promise.all([
      storage.setItem(checkpointKey(roomScope, state.sessionId), toSnapshotState(state)),
      storage.setItem(latestKey(roomScope), state.sessionId),
    ]).catch(() => console.warn('Novella checkpoint write failed'))
  }, [roomScope, state, storage])

  // Cold start: discover the last session via the pointer, then load it.
  const loadLatest = async (): Promise<VisualNovelSessionState | null> => {
    try {
      const sessionId = await storage.getItem(latestKey(roomScope))
      if (typeof sessionId !== 'string') return null
      const raw = await storage.getItem(checkpointKey(roomScope, sessionId))
      const result = validateSessionState(raw)
      const value = result.ok ? result.value : null
      setProvisional(value)
      return value
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

The provisional state renders read-only continuity while a bootstrap `STATE_REQUEST` is outstanding; the first authorized snapshot or `SESSION_STARTED` replaces it via `acceptCanonical`. If the room has moved to a different session, `clear` the stale checkpoint.

## Room scope and privacy

- Derive `roomScope` with a one-way digest of the room identifier if the storage key is inspectable.
- Never store room password, invite URL, crypto keys, transport SDP, peer metadata, or chat messages in the novella checkpoint.
- A checkpoint is provisional UI continuity only. It cannot become controller authority merely because it has a higher local revision.
- Provide “Reset local novella data” in story settings.

## Optional custom story packages after MVP

If added later, reuse the existing file-transfer service for a bounded archive, validate every archive path/type/size, assign a content digest, and require exact digest/version agreement before starting. Do not put archive bytes in action envelopes and do not make custom transfer part of MVP acceptance.
