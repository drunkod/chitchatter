# 13 — Full bootstrap, UI state, and room integration

> **Revision 8 changes:** bootstrap now loads both RoomMeta and the validated latest checkpoint before mounting sync, room changes synchronously discard the previous ready runtime, and completed-end rollback has explicit UI.

## Context status

Include `bootstrapping`, `lobby`, `starting`, `syncing`, `ready`, `waiting`, `reconciling`, `ending`, and `error`, plus `reconciliationMessage`, provisional controls, participation, and controller actions.

## Keyed two-stage provider

```tsx
export const VisualNovelProvider = (props: Props) => (
  <VisualNovelBootstrap key={props.roomId} {...props} />
)
```

The key guarantees a room change unmounts the old receiver immediately.

```tsx
const VisualNovelBootstrap = ({ children, transport, roomId }: Props) => {
  const storage = usePersistedStorage()
  const [result, setResult] = useState<BootstrapResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setResult(null)
    setError(null)
    void bootstrapVisualNovel(storage, roomId)
      .then(value => { if (!cancelled) setResult(value) })
      .catch(reason => { if (!cancelled) setError(toMessage(reason)) })
    return () => { cancelled = true }
  }, [roomId, storage])

  if (error) return <VisualNovelBootstrapError message={error} />
  if (!result) return <CircularProgress aria-label="Preparing story sync" />
  return <ReadyVisualNovelProvider {...result} transport={transport}>{children}</ReadyVisualNovelProvider>
}
```

## Complete bootstrap

```ts
const bootstrapVisualNovel = async (storage, roomId): Promise<BootstrapResult> => {
  const roomScope = await digestRoomId(roomId)
  const meta = await loadAndValidateRoomMeta(storage, roomScope)
  const checkpoint = await loadAndValidateLatestCheckpoint(storage, roomScope)
  validateBootstrapConsistency(meta, checkpoint)
  return { storage, roomScope, initialMeta: meta, initialCheckpoint: checkpoint }
}
```

Consistency rules include checkpoint epoch <= high water, tombstoned checkpoint rejection, and active-decision/migration semantic checks. No transport receiver exists before completion.

## Ready provider

Initialize React state as null and render the checkpoint as a read-only provisional baseline until canonical confirmation, or initialize a separate immutable `bootBaseline` supplied to sync. Fresh start remains blocked while a provisional checkpoint exists unless the user explicitly discards it.

All canonical replacement callbacks receive a mode (`normal`, `rollback`, `ended-by-certificate`). The callback clears losing checkpoints and renders the correct explanation only after the sync layer confirms safety metadata persisted.

## Reconciliation UI

For timeline replacement: “The room reconnected and selected another novella timeline. Story actions from the disconnected timeline were rolled back.”

For completed-end certificate: “The room had already ended this novella while you were disconnected. Later story actions on this timeline were rolled back.”

Chat/media/file UI remains mounted. Return from `reconciling` to `ready` or `lobby` after atomic render.

## Integration

Mount exactly once around group-room body, never DMs. Keep real `RoomVideoDisplay userId width height` props. Transport self identity always comes from `peerRoom.getSelfId()`, never UI user ID.

## Cleanup

Pending UI timers clear on unmount. The keyed provider ensures stale bootstrap promises and old-room receivers cannot survive navigation.
