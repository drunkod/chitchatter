# 07 — Existing-room transport adapter and paginated evidence delivery

> **Revision 13 changes:** transition proofs are page-delivered under the existing action channel, with request/source binding and no oversized monolithic evidence envelope.

Use the existing group-room `PeerRoom`. Do not create another room, peer identity, media stream, or signaling path.

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

One `PeerAction.VISUAL_NOVEL` channel carries the 26-action discriminated union.

## Identity

Every received outer envelope requires:

```ts
envelope.senderPeerId === messageContext.peerId
```

Holder-forwarded evidence always uses a fresh outer envelope. Embedded certificates retain their original bounded action/controller IDs.

## Proof-page delivery

For supersession or safety recovery:

- requester creates one outstanding recovery bound to exact target;
- holder computes one proof manifest and ordered pages;
- every page is sent as its own action envelope;
- send may resolve on enqueue; reliability comes from page-level retry;
- requester accepts reorder and duplicate identical pages;
- missing pages trigger bounded retry using the same request action ID;
- pages from another sender or proof ID never merge;
- a newer local generation/high water invalidates the assembly.

No page contains a current full state. After proof completion, active state uses ordinary `STATE_REQUEST`/`STATE_SNAPSHOT`.

## Freshness

Controller/progression/start/switch/migration UI paths call `ensureLatestGeneration()` before authority checks and enqueue. Stale operations cancel rather than sending one final obsolete action.

## Lifecycle

Handlers are keyed and removed individually. Peer visibility is advisory for migration opening only. Cleanup never flushes chat, media, file, or DM handlers.
