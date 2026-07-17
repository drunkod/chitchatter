# 07 — Existing-room transport adapter

> **Revision 9:** no new network primitive. All holder recovery uses fresh outer envelopes, and lifecycle/test semantics remain link-aware.

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

Add one short `PeerAction.VISUAL_NOVEL`. One action carries the discriminated envelope union.

## Identity rule

Every received outer envelope must satisfy:

```ts
envelope.senderPeerId === messageContext.peerId
```

Never resend another peer’s original envelope unchanged. `START_DECISION_GOSSIP` and `SESSION_END_NOTICE_GOSSIP` use a new outer envelope naming the holder.

Lifecycle handlers are keyed and removed individually. Novella cleanup never clears shared chat/media/file/DM handlers.
