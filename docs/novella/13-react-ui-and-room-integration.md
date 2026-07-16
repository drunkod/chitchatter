# 13 — React bootstrap, UI state, and room integration

> **Revision 7 changes:** splits asynchronous persistence bootstrap from the live sync runtime, exposes provisional discard through context, and adds an explicit reconciliation/rollback UI state.

## Context

```ts
export type VisualNovelStatus =
  | 'bootstrapping'
  | 'lobby'
  | 'starting'
  | 'loading'
  | 'syncing'
  | 'ready'
  | 'waiting'
  | 'reconciling'
  | 'ending'
  | 'error'

export interface VisualNovelContextValue {
  stories: VisualNovelManifest[]
  story: VisualNovelManifest | null
  state: VisualNovelSessionState | null
  provisional: VisualNovelSessionState | null
  scene: VisualNovelScene | null
  entry: VisualNovelDialogueEntry | null
  availableChoices: VisualNovelChoice[]
  status: VisualNovelStatus
  error: string | null
  reconciliationMessage: string | null
  isController: boolean
  pendingAction: boolean
  canStartStory: boolean
  participation: VisualNovelParticipation
  startStory: (storyId: string) => Promise<void>
  switchStory: (storyId: string) => Promise<void>
  advance: () => Promise<void>
  choose: (choiceId: string) => Promise<void>
  restart: () => Promise<void>
  endStory: () => Promise<void>
  leaveStory: () => void
  rejoinStory: () => Promise<void>
  requestControl: () => Promise<void>
  passControl: (peerId: string) => Promise<void>
  discardProvisional: () => Promise<void>
}
```

## Two-stage provider

Hooks cannot be conditionally skipped inside one component. Mount a bootstrap component first, then a child containing checkpoint and sync hooks:

```tsx
export const VisualNovelProvider = ({ children, transport, roomId }: Props) => {
  const { getPersistedStorage } = useContext(StorageContext)
  const storage = useMemo(() => getPersistedStorage(), [getPersistedStorage])
  const [bootstrap, setBootstrap] = useState<BootstrapResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void bootstrapVisualNovel(storage, roomId)
      .then(result => { if (!cancelled) setBootstrap(result) })
      .catch(reason => { if (!cancelled) setError(toMessage(reason)) })
    return () => { cancelled = true }
  }, [roomId, storage])

  if (error) return <VisualNovelBootstrapError message={error} />
  if (!bootstrap) return <CircularProgress aria-label="Preparing story sync" />

  return (
    <ReadyVisualNovelProvider
      transport={transport}
      storage={storage}
      roomScope={bootstrap.roomScope}
      initialMeta={bootstrap.meta}
    >
      {children}
    </ReadyVisualNovelProvider>
  )
}
```

```ts
const bootstrapVisualNovel = async (
  storage: StorageAdapter,
  roomId: string,
): Promise<BootstrapResult> => {
  const roomScope = await digestRoomId(roomId)
  const rawMeta = await storage.getItem(metaKey(roomScope))
  const meta = rawMeta === null
    ? emptyRoomMeta()
    : unwrapOrThrow(validateRoomMeta(rawMeta))
  return { roomScope, meta }
}
```

No novella transport receiver exists before this completes.

## Ready runtime

`ReadyVisualNovelProvider` may safely call:

```ts
const checkpoint = useVisualNovelCheckpoint({ storage, roomScope, state })
const sync = useVisualNovelSync({
  transport,
  initialMeta,
  persistMeta: meta => storage.setItem(metaKey(roomScope), meta).then(() => undefined),
  story,
  state,
  setState: applyCanonical,
  onParticipationChange: setParticipation,
  onSessionEnded: checkpoint.clear,
  onProtocolError: setError,
})
```

Load the provisional checkpoint on mount. Track `checkpointSettled`; fresh start requires `checkpointSettled`, `sync.phase === 'idle'`, no live state, and no provisional session unless the user explicitly discards it.

## Reconciliation UI

When start or migration conflict resolution replaces local state:

- set status `reconciling` before the atomic replacement;
- show “The room reconnected and selected another novella timeline. Story actions from the disconnected timeline were rolled back.”;
- preserve chat, media, and file UI;
- clear the losing checkpoint;
- return to `ready` after the canonical state renders.

This makes the availability-with-rollback model visible rather than silently rewriting the story.

## Provisional controls

`discardProvisional` is part of the context and return object:

```ts
const discardProvisional = async () => {
  const saved = checkpoint.provisional
  if (!saved) return
  await checkpoint.clear(saved.sessionId)
}
```

The lobby displays both “Waiting to reconnect…” and “Discard saved progress.”

## Room integration

Mount one provider only for the group room:

```tsx
<RoomContext.Provider value={roomContextValue}>
  {isDirectMessageRoom ? roomBody : (
    <VisualNovelProvider transport={peerRoom} roomId={roomId}>
      {roomBody}
    </VisualNovelProvider>
  )}
</RoomContext.Provider>
```

Keep existing video props:

```tsx
<RoomVideoDisplay userId={userId} width="100%" height="100%" />
```

Transport identity always comes from `peerRoom.getSelfId()`, not `userId`.

## Cleanup

Clear pending-action, start, reconciliation, migration, and termination timers. Room changes remount the provider with a new asynchronous scope; stale bootstrap promises are cancelled.
