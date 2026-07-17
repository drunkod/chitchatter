# 13 — Stable-generation bootstrap, canonical-store UI, and room integration

> **Revision 11 changes:** bootstrap now reads metadata/checkpoint coherently, exposes Web Lock and safety-capacity states, and refreshes generation before user actions.

## Keyed provider

```tsx
export const VisualNovelProvider = (props: Props) => (
  <VisualNovelBootstrap key={props.roomId} {...props} />
)
```

Room navigation immediately unmounts the old receiver/store subscription.

## Consistent bootstrap

1. derive room scope;
2. establish generation notification listener/buffer;
3. call `readConsistentBootstrap` under room lock;
4. validate RoomMeta and checkpoint from that snapshot;
5. classify checkpoint;
6. initialize canonical store/floor-only recovery;
7. recheck latest generation before receiver attachment;
8. retry whole bootstrap if generation changed;
9. attach receiver only after stable result.

No false “checkpoint above floor” error can arise from mixing generations.

## Floor-only recovery

If outcome is active but no full state exactly matches floor:

- render read-only recovery message;
- block fresh start/controller actions;
- request exact canonical session from floor controller/known holders;
- reject below-floor states;
- accept equal only with exact digest;
- allow higher authorized state using the same digest comparator and transaction.

## Canonical store

```tsx
const state = useSyncExternalStore(
  canonicalStore.subscribe,
  canonicalStore.getSnapshot,
  canonicalStore.getServerSnapshot,
)
```

React never mirrors origin, lineage, dispositions, certificates, generation, or floor in independent mutable refs.

## User-action freshness

Every novella button calls a service command that runs `ensureLatestGeneration()` before checking controller/participation/revision authority. A stale tab cannot enqueue one last action after missing a notification.

## Phases

Include `bootstrapping`, `recovering`, `lobby`, `starting`, `syncing`, `ready`, `waiting`, `reconciling`, `ending`, `safety-locked`, `capability-error`, and `error`.

Apply modes include normal, timeline rollback, ended certificate, switched successor, reconciled history, external-generation recovery, and floor-only recovery.

## Messages

- rollback: room selected another timeline; local novella actions rolled back;
- completed end: room had already ended this exact novella;
- switched successor: old session was replaced and current room story is being restored;
- reconciled history: timeline previously lost but newer valid progress may still compete;
- floor-only: latest state is being recovered before controls enable;
- safety capacity: safety evidence limit reached; novella is read-only until higher epoch/reset;
- lock unavailable: this browser cannot provide required cross-tab locking; novella sync is read-only.

Chat, media, screen share, and files remain mounted in every novella phase.

## Cleanup

Cancel stale bootstrap retries, exact recoveries, timers, focus listeners, generation subscriptions, and canonical-store subscriptions. Keep real `RoomVideoDisplay userId width height` props and transport identity from `peerRoom.getSelfId()`.
