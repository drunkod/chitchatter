# 07 — Existing-room transport adapter

> **Revision 10 changes:** adds ordinary-envelope transport for structured retirement gossip; no new WebRTC primitive is introduced.

Use the existing group-room `PeerRoom`; do not create another Trystero/WebRTC room or media stream.

```ts
export interface VisualNovelTransport {
  getSelfId(): string
  getPeers(): string[]
  makeAction<T extends DataPayload>(
    peerAction: PeerAction,
    namespace: string,
  ): PeerRoomAction<T>
  onPeerJoin(type: PeerHookType, handler: (peerId: string) => void): void
  onPeerLeave(type: PeerHookType, handler: (peerId: string) => void): void
  removePeerJoinHandler(type: PeerHookType): void
  removePeerLeaveHandler(type: PeerHookType): void
}
```

Add one short `PeerAction.VISUAL_NOVEL` entry. One transport action carries the discriminated envelope union.

## Identity

Every outer envelope must satisfy:

```ts
envelope.senderPeerId === messageContext.peerId
```

Never resend another peer’s original envelope unchanged. `START_DECISION_GOSSIP`, `SESSION_END_NOTICE_GOSSIP`, and `SESSION_RETIREMENT_GOSSIP` use a fresh outer envelope naming the holder and embed normalized durable evidence.

## Delivery semantics

Send resolution means enqueue, not delivery. Protocol finalization depends on ACKs or later evidence, never send resolution. Exact-target requests bind the target transport ID.

## Lifecycle

Keyed join/leave handlers are removed individually. Novella cleanup never flushes chat, media, file, or DM handlers. `getPeers()` is treated as a local transport view, not globally authoritative membership.
