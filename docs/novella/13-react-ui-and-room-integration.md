# 13 — Full bootstrap, canonical-store UI, and room integration

> **Revision 10 changes:** React subscribes to the transaction-owned canonical store, bootstrap discards authoritative-stale checkpoints, and floor-only recovery is explicit.

## Keyed bootstrap

```tsx
export const VisualNovelProvider = (props: Props) => (
  <VisualNovelBootstrap key={props.roomId} {...props} />
)
```

Bootstrap:

1. derives room scope;
2. loads and validates RoomMeta;
3. loads and semantically validates the latest checkpoint;
4. classifies the checkpoint;
5. clears an authoritative-stale pointer best-effort;
6. resolves stories for outcome/active records;
7. computes strongest complete baseline;
8. initializes the canonical store;
9. mounts the receiver.

## Floor-only bootstrap

If outcome is active but no full state matches the floor:

- render a read-only “Recovering the room’s novella” state;
- do not allow fresh start or local controller actions;
- issue exact-target bootstrap recovery to current controller/known peers;
- reject states below the floor;
- accept an equal state only with matching digest;
- permit a higher authorized complete state and advance the floor transactionally.

## Canonical store subscription

```tsx
const state = useSyncExternalStore(
  canonicalStore.subscribe,
  canonicalStore.getSnapshot,
  canonicalStore.getServerSnapshot,
)
```

The store is updated synchronously inside the metadata Web Lock. React does not receive independent delayed install callbacks and does not mirror active decision, lineage, dispositions, or certificates.

## UI phases

Include `bootstrapping`, `recovering`, `lobby`, `starting`, `syncing`, `ready`, `waiting`, `reconciling`, `ending`, and `error`.

Apply modes:

- `normal`;
- `timeline-rollback`;
- `ended-by-certificate`;
- `retired-by-switch`;
- `reconciled-history`;
- `external-generation-recovery`.

## Messages

- rollback: “The room reconnected and selected another novella timeline. Story actions from the disconnected timeline were rolled back.”
- completed end: “The room had already ended this novella while you were disconnected.”
- switched: “This novella session was replaced by a story switch.”
- reconciliation history: “This timeline previously lost a room comparison, but newer valid progress may still be compared.”
- floor-only recovery: “Recovering the latest novella state before controls are enabled.”

Chat, media, screen share, and files remain mounted.

## Integration and cleanup

Mount once around group-room body, never DM rooms. Keep real `RoomVideoDisplay userId width height` props. Transport identity comes from `peerRoom.getSelfId()`.

Keyed provider immediately removes old receiver/store subscription on navigation. Stale bootstrap promises, recovery operations, and UI timers are cancelled.
