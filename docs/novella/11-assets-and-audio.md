# 11 — Assets and local story audio

> **Revision 4 changes:** none functional since Revision 3 (local failure collection, absolute-URL music compare). Split into its own step.

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

- Background failure: theme background color/gradient, retain dialogue.
- Character failure: omit the image, retain speaker name/text.
- Music/SFX failure: non-blocking muted indicator; never block state application.
- No infinite retries; one user-triggered retry for MVP.
- Preload only current and probable next scenes.

## `src/hooks/useVisualNovelAudio.ts`

Story music and effects are local. They never use `PeerRoom.addStream` and never modify the microphone stream.

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
    // HTMLAudioElement.src is absolutized by the browser — pass the resolved
    // absolute URL from useVisualNovelAssets so this compare works.
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
    musicVolume, effectsVolume, isAutoplayBlocked,
    setMusicVolume, setEffectsVolume,
    playMusic, playEffect, stopMusic, resumeAfterGesture,
  }
}
```

Trigger music when the canonical scene changes and SFX when the canonical dialogue entry changes. Duplicate action suppression prevents repeated effects from the same envelope; also key effects by `sessionId/revision/dialogueEntryId` for React Strict Mode.

## Audio controls

```tsx
<Stack direction="row" spacing={2} aria-label="Story audio">
  <Slider aria-label="Story music volume" min={0} max={1} step={0.05}
    value={musicVolume} onChange={(_, value) => setMusicVolume(value as number)} />
  <Slider aria-label="Story sound effects volume" min={0} max={1} step={0.05}
    value={effectsVolume} onChange={(_, value) => setEffectsVolume(value as number)} />
</Stack>
```

These controls are separate from voice-communication volume.
