# 07 — Existing-room transport adapter

> **Revision 12 changes:** adds bounded supersession/floor/safety-recovery envelopes and binds election advertisements to exact migration records without adding another network primitive.

Use the existing group-room `PeerRoom`. Do not create a second WebRTC room, identity, microphone, or media stream.

```ts
export interface VisualNovelTransport {
  getSelfId(): string
  getPeers(): string[]
  makeAction<T extends DataPayload>(peerAction: PeerAction, namespace: string): PeerRoomAction<T>
  onPeerJoin(type: PeerHookType, handler: (peerId: string) => void): void
  onPeerLeave(type: PeerHookType, handler: (peerId: string) => void): void
  removePeerJoinHandler(type: PeerHookType): void
  removePeerLeaveHandler(type: PeerHookType): void
}
```

One `PeerAction.VISUAL_NOVEL` value carries the discriminated envelope union.

## Identity

For every received envelope:

```ts
envelope.senderPeerId === messageContext.peerId
```

A holder never forwards another peer’s outer envelope unchanged. Fresh holder envelopes may embed normalized decisions, transition certificates, completed-end certificates, dispositions, floor evidence, or supersession chains.

## Outbound freshness

Before controller/progression/start/switch/migration sends, call `ensureLatestGeneration()`. If metadata advanced, cancel the action and enter recovery/read-only as required.

## Bounded response rules

- below-high-water traffic receives `SESSION_SUPERSESSION_GOSSIP`, never a silent stale drop;
- floor-only winner replies use `STATE_FLOOR_GOSSIP`;
- capacity-locked peers may send/receive only the dedicated safety-recovery actions plus noninstalling evidence;
- supersession chains and target lists obey explicit count and byte limits;
- election advertisements include migration ID, departed controller, and opening revision.

## Lifecycle

Peer visibility is advisory. Absence opens a migration record; later rejoin does not revoke that durable record. Handlers are keyed and removed individually; novella cleanup never flushes chat/media/file/DM handlers.
