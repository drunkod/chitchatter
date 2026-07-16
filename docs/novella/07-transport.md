# 07 — Transport: network action, PeerRoom additions, interface

> **Revision 4 changes:** none functional since Revision 3; kept as its own step so transport work can merge independently. The test-mesh defects called out in review are fixed in 13.

## Extend `src/models/network.ts`

```ts
// NOTE: Action names are limited to 12 characters, otherwise Trystero breaks.
export enum PeerAction {
  MESSAGE = 0,
  MEDIA_MESSAGE,
  MESSAGE_TRANSCRIPT,
  PEER_METADATA,
  AUDIO_CHANGE,
  VIDEO_CHANGE,
  SCREEN_SHARE,
  FILE_OFFER,
  TYPING_STATUS_CHANGE,
  VISUAL_NOVEL,
}
```

With namespace `` `${ActionNamespace.GROUP}vn` `` the wire action name is `gvn.9` (5 chars) — safely under the limit. Do not add one enum member per novella action; the semantic name is `envelope.actionType`.

## Extend `src/lib/PeerRoom/PeerRoom.ts`

```ts
import { joinRoom, selfId /* … existing imports … */ } from '@trystero-p2p/torrent'

export enum PeerHookType {
  NEW_PEER = 'NEW_PEER',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
  SCREEN = 'SCREEN',
  FILE_SHARE = 'FILE_SHARE',
  VISUAL_NOVEL = 'VISUAL_NOVEL',
}

// Inside PeerRoom:
getSelfId = () => selfId

removePeerJoinHandler = (peerHookType: PeerHookType) => {
  this.peerJoinHandlers.delete(peerHookType)
}

removePeerLeaveHandler = (peerHookType: PeerHookType) => {
  this.peerLeaveHandlers.delete(peerHookType)
}
```

Facts these changes rely on (verified in the repo):

- Nothing in `src/` currently exposes the transport self ID; Trystero exports `selfId`.
- `PeerRoom.getPeers()` returns the currently connected remote transport peer IDs — the correct election input when combined with the local ID.
- `PeerRoom` stores **one** join and one leave handler per `PeerHookType`. This is why exactly one novella provider may exist per browser (10), and why cleanup must use keyed removal, never `flush()`.

## `src/services/visualNovel/VisualNovelTransport.ts`

The sync hook depends on this narrow interface, not the concrete `PeerRoom` class — `PeerRoom` has private members, so a standalone test double is not structurally assignable to the class, but the class **is** structurally assignable to this interface.

```ts
import type { DataPayload } from 'trystero'
import type { PeerHookType, PeerRoomAction } from 'lib/PeerRoom'
import type { PeerAction } from 'models/network'

export interface VisualNovelTransport {
  getSelfId: () => string
  getPeers: () => string[]
  makeAction: <T extends DataPayload>(
    peerAction: PeerAction,
    namespace: string
  ) => PeerRoomAction<T>
  onPeerJoin: (type: PeerHookType, handler: (peerId: string) => void) => void
  onPeerLeave: (type: PeerHookType, handler: (peerId: string) => void) => void
  removePeerJoinHandler: (type: PeerHookType) => void
  removePeerLeaveHandler: (type: PeerHookType) => void
}
```

Notes:

- `PeerRoomAction<T>` is the repository's **mutable** 3-tuple `[sender, connectReceiver, progress]`, where `connectReceiver(cb)` returns its own unsubscribe function. Test doubles must return exactly this type — not a readonly `as const` tuple (13).
- `usePeerAction` currently takes a `PeerRoom`. Either widen its prop type to `VisualNovelTransport` (it only calls `makeAction`) or call `transport.makeAction` directly inside the sync hook. Pick one and keep it consistent; the docs assume the direct call.

## Envelope factory

`src/services/visualNovel/createVisualNovelEnvelope.ts` — takes an explicit scope so bootstrap requests are possible with null local state (a session state satisfies `VisualNovelScope` structurally; bootstrap callers pass `visualNovelBootstrapScope`):

```ts
import { visualNovelProtocolVersion } from 'config/visualNovel'
import type {
  EnvelopeFor,
  VisualNovelActionType,
  VisualNovelPayloadByAction,
  VisualNovelScope,
} from 'models/visualNovel'

export interface EnvelopeDependencies {
  actionId: () => string
  now: () => number
}

export const createVisualNovelEnvelope = <T extends VisualNovelActionType>(
  actionType: T,
  payload: VisualNovelPayloadByAction[T],
  scope: VisualNovelScope,
  senderPeerId: string,
  revision: number,
  dependencies: EnvelopeDependencies
): EnvelopeFor<T> => ({
  protocol: 'visual-novel',
  protocolVersion: visualNovelProtocolVersion,
  actionId: dependencies.actionId(),
  actionType,
  sessionId: scope.sessionId,
  storyId: scope.storyId,
  storyVersion: scope.storyVersion,
  senderPeerId,
  revision,
  timestamp: dependencies.now(),
  payload,
})
```
