# 07 — Existing-room transport adapter

> **Revision 8:** no new transport primitive. The new start and completed-end gossip actions use ordinary envelopes whose outer sender always matches transport context.

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

Add only one short `PeerAction.VISUAL_NOVEL` entry within the repository action-name limit. One transport action carries the discriminated envelope union.

## Identity rule

For every received outer envelope:

```ts
envelope.senderPeerId === messageContext.peerId
```

A peer must never resend another peer's original envelope unchanged. `START_DECISION_GOSSIP` and `SESSION_END_NOTICE_GOSSIP` solve that by using a fresh outer envelope naming the holder and embedding the normalized original decision/certificate.

Lifecycle handlers are keyed and removed individually. Novella cleanup never flushes shared chat, media, file, or DM handlers.
