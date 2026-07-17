# 07 — Existing-room transport adapter

> **Revision 11 changes:** no new network primitive is added; switched disposition replies now embed successor evidence, and every outbound state-changing action performs a generation freshness check before enqueue.

Use the existing group-room `PeerRoom`. Do not create another Trystero/WebRTC room, peer identity, microphone, or media stream.

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

One short `PeerAction.VISUAL_NOVEL` value carries the discriminated envelope union.

## Identity rule

For every received outer envelope:

```ts
envelope.senderPeerId === messageContext.peerId
```

Never resend another peer’s original outer envelope unchanged. Holder-forwarded actions use fresh outer envelopes:

- `START_DECISION_GOSSIP` embeds the decision and known state;
- `SESSION_END_NOTICE_GOSSIP` embeds the completed certificate;
- `SESSION_RETIREMENT_GOSSIP` embeds the normalized disposition and successor evidence when required.

The embedded original end or normalized origin retains protocol evidence under the honest-peer MVP model.

## Freshness before send

Controller/progression/start/switch/migration UI paths call `ensureLatestGeneration()` before authority checks and enqueue. If metadata advanced, the action is cancelled and the runtime enters recovery/read-only as appropriate.

## Lifecycle handlers

Handlers are keyed and removed individually. Novella cleanup never flushes chat, media, file, or DM handlers. Transport peer visibility is advisory for migration; durable lineage remains authority.
