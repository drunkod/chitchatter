# 13 — Full bootstrap, UI state, and room integration

> **Revision 9 changes:** bootstrap explicitly chooses the strongest checkpoint/decision baseline and presents separate messages for timeline rollback, completed end, and non-end retirement.

## Keyed bootstrap

```tsx
export const VisualNovelProvider = (props: Props) => (
  <VisualNovelBootstrap key={props.roomId} {...props} />
)
```

Bootstrap derives room scope, loads/validates RoomMeta, loads/validates latest checkpoint, resolves exact stories for active records, validates cross-consistency, and returns the strongest boot baseline. No receiver exists before completion.

```ts
const bootBaseline = strongestState(
  checkpoint,
  meta.activeStartDecision?.state,
  meta.activeMigration?.lastAppliedState,
)
```

Only same-epoch valid candidates participate. A progressed checkpoint outranks revision-0 evidence.

## Ready runtime

Render checkpoint as read-only provisional state until canonical confirmation. Fresh start is blocked while provisional state exists unless explicitly discarded. The sync layer owns safety records; React does not mirror active decision/migration/certificates in independent refs.

Canonical apply modes:

- `normal`;
- `timeline-rollback`;
- `ended-by-certificate`;
- `retired-by-switch`;
- `retired-by-reconciliation`.

Callbacks run only after locked metadata persistence succeeds.

## User messages

- timeline rollback: “The room reconnected and selected another novella timeline. Story actions from the disconnected timeline were rolled back.”
- completed end: “The room had already ended this novella while you were disconnected. Later actions on this timeline were rolled back.”
- retired session: “This saved novella timeline was replaced by a newer room decision.”

Chat, media, screen share, and file UI remain mounted.

## Integration and cleanup

Mount once around group-room body, never direct-message rooms. Keep real `RoomVideoDisplay userId width height` props. Transport identity comes from `peerRoom.getSelfId()`.

Keyed provider immediately removes old-room receiver on navigation. Stale bootstrap promises and UI timers are cancelled.
