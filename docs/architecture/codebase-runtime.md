# Codebase and runtime architecture

This document describes the major implementation layers and the flows connecting React, local browser services, Trystero/WebRTC, and remote peers.

## 1. Major code layers

Graphify identifies the UI shell, room component, room hooks, and `PeerRoom` as the central application subgraph. The source is organized as layered modules rather than a separate backend-driven chat architecture.

```mermaid
flowchart TD
    Entry[Entry and initialization] --> App[Application composition]
    App --> Pages[Route pages]
    App --> Components[Reusable UI components]
    Components --> Hooks[Room and feature hooks]
    Pages --> Hooks
    Hooks --> Contexts[React contexts]
    Hooks --> Services[Browser services]
    Hooks --> PeerRoom[PeerRoom adapter]
    PeerRoom --> Trystero[Trystero torrent room]
    Trystero --> WebRTC[WebRTC data channels and media]
    WebRTC --> Peers[Remote browsers]

    Services --> Encryption[Web Crypto encryption service]
    Services --> FileTransfer[Secure file transfer]
    Services --> Notification[Browser notifications]
    Services --> Serialization[Settings serialization]
    Services --> Storage[IndexedDB through localForage]
```

### Directory roles

| Area | Responsibility |
| --- | --- |
| `src/pages/` | Route-level screens and route parameter handling |
| `src/components/Shell/` | Persistent app frame, global room state, navigation, peer list, dialogs |
| `src/components/Room/` | Room presentation and feature-specific media/file hooks |
| `src/hooks/` | Shared React integration such as peer actions and throttled mounting |
| `src/lib/PeerRoom/` | Adapter around Trystero room actions, events, peers, and streams |
| `src/services/` | Encryption, serialization, notification, settings, and file transfer |
| `src/contexts/` | State contracts shared across shell, settings, storage, and room UI |
| `src/models/` | Chat, network, settings, routing, storage, and SDK types |
| `sdk/` | Embedding SDK/web-component integration |
| `api/` | Runtime configuration endpoint |

## 2. State ownership and context boundaries

```mermaid
flowchart TD
    Bootstrap[Bootstrap] --> SettingsContext[SettingsContext]
    Bootstrap --> StorageContext[StorageContext]
    Bootstrap --> Router[Router]
    SettingsContext --> Shell[Shell]
    StorageContext --> Shell

    Shell --> ShellContext[ShellContext]
    ShellContext --> ShellState[Navigation, alerts, title, fullscreen]
    ShellContext --> PeerState[Peer list and connection state]
    ShellContext --> MediaState[Local media control state]
    ShellContext --> PeerAudio[Peer HTMLAudioElements and volume state]
    ShellContext --> MessageState[Group and direct-message logs]
    ShellContext --> PeerRoomRef[Shared PeerRoom reference]

    ShellContext --> RoutePage[Current route page]
    RoutePage --> Room[Room]
    Room --> RoomContext[RoomContext]
    RoomContext --> VisualStreams[Local and remote webcam and screen streams]
    RoomContext --> FileOffers[File offers and FileTransferService]
    RoomContext --> RoomView[Room controls, video display, and chat]
```

`ShellContext` has a wider lifetime than `RoomContext`. This allows shell-level peer and message state—especially direct-message logs—to remain available while route content changes. `RoomContext` is scoped to the mounted room and exposes state needed by room controls and displays.

## 3. Room creation and peer lifecycle

```mermaid
sequenceDiagram
    participant Page as PublicRoom or PrivateRoom
    participant Room as RoomCore
    participant Hook as useRoom
    participant Adapter as PeerRoom
    participant Network as Trystero room
    participant Peer as Remote peer

    Page->>Room: Render with room ID and optional secret
    Room->>Hook: Provide room and RTC configuration
    Hook->>Adapter: Create or reuse PeerRoom
    Adapter->>Network: joinRoom configuration and room ID
    Network-->>Adapter: Peer joins
    Adapter-->>Hook: NEW_PEER callback
    Hook->>Hook: Sign room ID plus user ID
    Hook->>Peer: Send user ID, username, public key, signature
    Hook->>Peer: Send public-room transcript when applicable
    Peer-->>Hook: Peer metadata
    Hook->>Hook: Parse public key and verify signature
    Hook->>Hook: Add or update peer in ShellContext
    Hook->>Adapter: Query direct or relay connection type
```

A `PeerRoom` instance wraps the underlying Trystero room. It multiplexes multiple join, leave, and stream handlers, caches named actions, and reports whether each WebRTC connection selected a direct or relay candidate.

Public group rooms key `Room` by `roomId`; private group rooms key it by `roomId` plus the derived secret. Changing connection identity therefore unmounts the old room before mounting a new transport, even if throttle state updates are batched. On group-room unmount, `useRoom` leaves the room, flushes handlers, clears the peer reference, resets the peer list, and clears the group message log. Direct-message views reuse the active group-room transport instead of leaving it.

## 4. Peer action abstraction

Features communicate through named actions. `usePeerAction` connects a React lifecycle to a cached `PeerRoom.makeAction` result, while each receiver registration gets its own unsubscribe closure.

```mermaid
flowchart TD
    FeatureA[Feature hook A] --> UseA[usePeerAction A]
    FeatureB[Feature hook B] --> UseB[usePeerAction B]
    UseA --> Cached[Cached PeerRoom action tuple]
    UseB --> Cached
    Cached --> Event[Shared EventTarget]
    UseA --> ConnectA[connectReceiver registers listener A]
    UseB --> ConnectB[connectReceiver registers listener B]
    ConnectA --> UnsubscribeA[Closure captures listener A]
    ConnectB --> UnsubscribeB[Closure captures listener B]
    Event --> ListenerA[Dispatch to listener A]
    Event --> ListenerB[Dispatch to listener B]
    UseA --> CleanupA[Unmount A invokes unsubscribe A]
    CleanupA --> RemoveA[Remove listener A only]
    ListenerB --> Active[Listener B remains active]
```

Group actions use the `g` namespace. Direct-message actions use `dm` and are sent with a target peer ID. Incoming direct-message text and inline-media handlers also reject payloads whose sender does not match the room's `targetPeerId`. `PeerRoom.makeAction` still caches the transport action, but `connectReceiver` returns a closure over the exact listener it registered, so multiple `keepMounted` direct-message rooms can subscribe and clean up independently.

## 5. Text-message flow

```mermaid
sequenceDiagram
    participant User
    participant Form as MessageForm
    participant Hook as useRoom
    participant Shell as ShellContext message log
    participant Action as PeerRoom message action
    participant Peer as Remote browser
    participant UI as ChatTranscript

    User->>Form: Submit text
    Form->>Hook: sendMessage text
    Hook->>Hook: Build message with author, ID, and send time
    Hook->>Shell: Add optimistic unsent message
    Hook->>Action: Send group or targeted direct message
    Action->>Peer: WebRTC data payload
    Hook->>Shell: Mark local message received with receive time
    Shell-->>UI: Render updated transcript
    Peer-->>Action: Incoming message
    Action-->>Hook: Receive message and peer context
    Hook->>Hook: Sound or notification when appropriate
    Hook->>Shell: Append message and clear group-typing flag
    Shell-->>UI: Render updated transcript
```

The shell stores separate group and per-peer direct-message logs. Transcript updates use functional state updates so messages arriving while a send is awaiting network completion are preserved. Optimistic local entries are replaced by ID when their send completes rather than rebuilding the transcript from a captured array. If a text or inline-media action rejects, the optimistic entry is removed, an error alert is shown, and sending controls are re-enabled in `finally`. Transcript size is bounded; evicted inline-media offers are rescinded when still active.

The receive handler currently clears only `isTypingGroupMessage`, even for the direct-message namespace. It does not clear `isTypingDirectMessage`. This diagram documents that current behavior; it should not be interpreted as namespace-aware typing cleanup.

## 6. Audio, video, and screen-share flow

```mermaid
flowchart TD
    Control[Room media control] --> Kind{Media kind}

    Kind -- Webcam or screen --> VisualHook[Video or screen-share hook]
    VisualHook --> VisualCapture[Browser media capture API]
    VisualCapture --> VisualLocal[Local MediaStream]
    VisualLocal --> VisualContext[RoomContext visual streams]
    VisualHook --> VisualAction[Send video or screen state action]
    VisualHook --> VisualPeerRoom[PeerRoom.addStream]
    VisualPeerRoom --> VisualQueue[Delayed stream queue]
    VisualQueue --> VisualRemote[Remote peers]
    VisualRemote --> VisualIncoming[onPeerStream]
    VisualIncoming --> VisualHook
    VisualHook --> VisualContext
    VisualContext --> Display[RoomVideoDisplay]

    Kind -- Microphone --> AudioHook[useRoomAudio]
    AudioHook --> AudioCapture[getUserMedia audio]
    AudioCapture --> AudioPeerRoom[PeerRoom.addStream]
    AudioHook --> AudioAction[Send audio state action]
    AudioPeerRoom --> AudioQueue[Delayed stream queue]
    AudioQueue --> AudioRemote[Remote peers]
    AudioRemote --> AudioIncoming[onPeerStream audio]
    AudioIncoming --> AudioElement[Create autoplaying HTMLAudioElement]
    AudioElement --> AudioShell[ShellContext peerAudioChannels]
    AudioShell --> AudioUI[Playback and volume UI]
```

`PeerRoom` serializes all stream additions with a delay. This prevents stream and metadata races on receiving peers. Webcam and screen-share streams pass through `RoomContext` and control `RoomVideoDisplay`. Incoming microphone streams do not enter `RoomContext`; `useRoomAudio` converts them directly to autoplaying `HTMLAudioElement` instances and stores them in `ShellContext.peerAudioChannels`.

## 7. Inline media and file transfer

File selection creates a general file offer for the full `FileList`. If any files are inline-classified by MIME top-level type (`image`, `audio`, or `video`), it also starts a second offer for that subset. Inline classification is broader than preview support: the renderer currently supports selected image and audio filename extensions, while video files are classified for inline delivery but render “Media preview not supported.” The two offers have different peer-action metadata and receiving UI paths.

```mermaid
sequenceDiagram
    participant User
    participant Controls as File upload controls
    participant Share as useRoomFileShare
    participant Room as useRoom
    participant Transfer as FileTransferService
    participant Actions as Peer actions
    participant Remote as Remote browser
    participant Preview as Remote InlineMedia

    User->>Controls: Select files
    Controls->>Share: handleFileShareStart with full FileList
    Share->>Transfer: Offer all selected files
    Transfer-->>Share: General magnet URI

    opt At least one inline-classified file
        Share->>Room: Start handleInlineMediaUpload without awaiting it
        Room->>Transfer: Begin second offer for inline subset
    end

    Share->>Actions: Broadcast FILE_OFFER metadata while inline offer may be pending
    Actions->>Remote: General magnet URI and all-inline flag
    Remote->>Remote: Expose general offer in peer/file-download UI

    opt Inline subset offer completes
        Transfer-->>Room: Inline-preview magnet URI
        Room->>Actions: Broadcast MEDIA_MESSAGE
        Actions->>Remote: Author, inline magnet URI, ID, and time
        Remote->>Preview: Render message and mount InlineMedia
        Preview->>Transfer: Automatically download inline magnet URI
        Transfer-->>Preview: Torrent files for inline rendering
    end
```

After the general offer resolves, `useRoomFileShare` starts `handleInlineMediaUpload` first and does not await its promise. It then broadcasts the general `FILE_OFFER`, so the inline subset offer may overlap the metadata broadcast. When that second offer eventually resolves, `MEDIA_MESSAGE` advertises its magnet URI in the chat transcript. On the receiving side, mounting `InlineMedia` automatically invokes `fileTransfer.download`; no explicit user retrieval step is required for the inline delivery, although unsupported extensions display a fallback instead of a preview.

Received general-offer metadata is merged into the peer-keyed record rather than replacing other peers' entries. Rescinding an offer removes only that peer's entry and safely handles an already-absent entry. `FileTransferService` configures `secure-file-transfer` with the same tracker list and current RTC configuration used by the room's connectivity layer.

## 8. Private-room security flow

```mermaid
flowchart TD
    Route[Private room route] --> Parse[Parse fragment parameters]
    Parse --> Advanced{Non-empty fragment and BrowserRouter advanced sharing?}
    Advanced -- Yes --> Clear[Remove entire fragment from visible address bar]
    Advanced -- No --> Keep[Keep address bar unchanged]
    Clear --> Params{Parsed parameters?}
    Keep --> Params
    Params -- secret --> Secret[Use parsed secret]
    Params -- legacy pwd --> Legacy[Encode pwd with room ID]
    Legacy --> Secret
    Params -- none --> Prompt[Prompt for password]
    Prompt --> Encode[Encode password with room ID]
    Encode --> Secret
    Secret --> RoomConfig[Use secret as room password]
    RoomConfig --> Join[Join P2P room]

    Join --> Proof[Sign room ID plus asserted user ID]
    Proof --> Metadata[Send asserted user ID, public key, and signature]
    Metadata --> Verify[Verify self-signed metadata and private-key possession]
    Verify --> State[Record cryptographic consistency result]
```

The user's key pair is created in the browser. Each peer supplies an asserted user ID, its public key, and a signature produced by the corresponding private key over the room/user string. A successful check proves possession of that private key and detects inconsistency or tampering in the signed metadata. It does **not** authenticate a real-world identity or prove that the asserted user ID belongs to a previously known person: this flow has no certificate authority, pinned key, trust-on-first-use record, or out-of-band fingerprint comparison. The implementation's `VERIFIED` and `UNVERIFIED` labels should therefore be understood as cryptographic consistency states, not identity trust decisions.

Fragment parameters are snapshotted inside an effect keyed by `roomId` before the visible hash is cleared. Clearing the address bar therefore cannot retrigger the effect and erase the newly loaded secret. Changing rooms clears the previous secret immediately, and stale asynchronous derivations cannot update the new room. If advanced sharing is enabled for `BrowserRouter`, every non-empty fragment is removed before the snapshotted `secret` or legacy `pwd` branch is processed. A legacy `pwd` value is encoded with the room ID automatically.

## 9. Embedded SDK configuration

```mermaid
sequenceDiagram
    participant Host as Host page
    participant Frame as Chitchatter iframe
    participant Bootstrap
    participant Settings as SettingsContext

    Frame->>Bootstrap: Start with query parameters
    alt getSdkConfig is present and parentDomain is a valid URL
        Bootstrap->>Bootstrap: Decode parentDomain and derive trusted origin
        Bootstrap->>Host: CONFIG_REQUESTED to trusted origin
        Host-->>Bootstrap: CONFIG from matching origin
        Bootstrap->>Bootstrap: Validate origin and event shape, then merge payload
    else getSdkConfig is absent or parentDomain is invalid
        Bootstrap->>Bootstrap: Skip or fail initial request and continue with local settings
    end
    Bootstrap->>Settings: Publish effective settings
    alt embed is present
        Bootstrap->>Bootstrap: Do not persist settings and install update listener
        Host-->>Bootstrap: Later configuration message
        alt parentDomain resolves, origin matches, and event shape is valid
            Bootstrap->>Settings: Apply in-memory override
        else validation fails
            Bootstrap->>Bootstrap: Ignore message
        end
    else embed is absent
        Bootstrap->>Bootstrap: Persist settings normally
        Bootstrap->>Bootstrap: Do not install embedded update listener
    end
```

`getSdkConfig` and `embed` are independent flags. `getSdkConfig` selects the initial handshake path, but a present, valid `parentDomain` is also required: it supplies the target origin for `postMessage` and the trusted origin used to validate replies. Incoming configuration is accepted only when `parentDomain` can be resolved, `event.origin` matches it, and the event has the expected configuration shape. `embed` suppresses persistence and enables the listener for subsequent configuration messages; those messages are subject to the same origin and shape validation. Merely embedding the iframe does not initiate the request handshake unless `getSdkConfig` is present and `parentDomain` is valid.

## Source anchors

- [`src/Bootstrap.tsx`](../../src/Bootstrap.tsx)
- [`src/components/Shell/Shell.tsx`](../../src/components/Shell/Shell.tsx)
- [`src/components/Shell/PeerListItem.tsx`](../../src/components/Shell/PeerListItem.tsx)
- [`src/contexts/ShellContext.ts`](../../src/contexts/ShellContext.ts)
- [`src/components/Room/Room.tsx`](../../src/components/Room/Room.tsx)
- [`src/components/Room/useRoom.ts`](../../src/components/Room/useRoom.ts)
- [`src/components/Room/useRoomFileShare.ts`](../../src/components/Room/useRoomFileShare.ts)
- [`src/components/Message/InlineMedia.tsx`](../../src/components/Message/InlineMedia.tsx)
- [`src/hooks/usePeerAction.ts`](../../src/hooks/usePeerAction.ts)
- [`src/lib/PeerRoom/PeerRoom.ts`](../../src/lib/PeerRoom/PeerRoom.ts)
- [`src/services/FileTransfer/FileTransfer.ts`](../../src/services/FileTransfer/FileTransfer.ts)
- [`src/pages/PublicRoom/PublicRoom.tsx`](../../src/pages/PublicRoom/PublicRoom.tsx)
- [`src/pages/PrivateRoom/PrivateRoom.tsx`](../../src/pages/PrivateRoom/PrivateRoom.tsx)
