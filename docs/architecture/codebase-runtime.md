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

On group-room unmount, `useRoom` leaves the room, flushes handlers, clears the peer reference, resets the peer list, and clears the group message log. Direct-message views reuse the active room instead of leaving it.

## 4. Peer action abstraction

Features communicate through named actions. `usePeerAction` connects a React lifecycle to a cached `PeerRoom.makeAction` result.

```mermaid
flowchart LR
    Feature[Feature hook] --> UseAction[usePeerAction]
    UseAction --> Make[PeerRoom.makeAction]
    Make --> Name[Namespace plus PeerAction]
    Name --> TrysteroAction[Trystero makeAction]
    TrysteroAction --> Sender[Sender returned to feature]
    TrysteroAction --> Receive[onMessage callback]
    Receive --> Event[Local EventTarget dispatch]
    Event --> ReactHandler[Feature receive handler]
    UseAction --> Cleanup[Disconnect receiver on unmount]
```

Group actions use the `g` namespace. Direct-message actions use `dm` and are sent with a target peer ID.

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

The shell stores separate group and per-peer direct-message logs. Transcript size is bounded; evicted inline-media offers are rescinded when still active.

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
    AudioPeerRoom --> AudioRemote[Remote peers]
    AudioRemote --> AudioIncoming[onPeerStream audio]
    AudioIncoming --> AudioElement[Create autoplaying HTMLAudioElement]
    AudioElement --> AudioShell[ShellContext peerAudioChannels]
    AudioShell --> AudioUI[Playback and volume UI]
```

`PeerRoom` serializes all stream additions with a delay. This prevents stream and metadata races on receiving peers. Webcam and screen-share streams pass through `RoomContext` and control `RoomVideoDisplay`. Incoming microphone streams do not enter `RoomContext`; `useRoomAudio` converts them directly to autoplaying `HTMLAudioElement` instances and stores them in `ShellContext.peerAudioChannels`.

## 7. Inline media and file transfer

Inline media uses two coordinated channels: a peer action announces the magnet URI in the chat transcript, while `secure-file-transfer` handles the actual file offer and transfer.

```mermaid
sequenceDiagram
    participant User
    participant Controls as File upload controls
    participant Hook as useRoom
    participant Transfer as FileTransferService
    participant Message as Media-message action
    participant Peer as Remote browser
    participant Transcript as ChatTranscript

    User->>Controls: Select inline-media files
    Controls->>Hook: handleInlineMediaUpload
    Hook->>Transfer: Offer files with room ID
    Transfer-->>Hook: Magnet URI or offer ID
    Hook->>Transcript: Add optimistic inline-media entry
    Hook->>Message: Broadcast inline-media metadata
    Message->>Peer: Author, magnet URI, ID, and time
    Peer->>Transfer: Retrieve offered content
    Hook->>Transcript: Mark local entry received
```

`FileTransferService` configures `secure-file-transfer` with the same tracker list and current RTC configuration used by the room's connectivity layer.

## 8. Private-room security flow

```mermaid
flowchart TD
    Route[Private room route] --> Fragment{Fragment parameters?}
    Fragment -- secret --> Read[Read secret locally]
    Read --> Advanced{BrowserRouter advanced sharing?}
    Advanced -- Yes --> Clear[Remove fragment from visible address bar]
    Advanced -- No --> Secret[Keep parsed secret]
    Clear --> Secret
    Fragment -- legacy pwd --> Legacy[Encode pwd with room ID]
    Legacy --> Secret
    Fragment -- none --> Prompt[Prompt for password]
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

Fragment clearing is also conditional: `allowAdvancedRoomLinkSharing` is enabled only for `BrowserRouter`. A legacy `pwd` fragment parameter is accepted and encoded with the room ID automatically.

## 9. Embedded SDK configuration

```mermaid
sequenceDiagram
    participant Host as Host page
    participant Frame as Chitchatter iframe
    participant Bootstrap
    participant Settings as SettingsContext

    Frame->>Bootstrap: Start with query parameters
    alt getSdkConfig is present
        Bootstrap->>Host: CONFIG_REQUESTED postMessage
        Host-->>Bootstrap: Initial configuration payload
        Bootstrap->>Bootstrap: Merge host configuration
    else getSdkConfig is absent
        Bootstrap->>Bootstrap: Skip initial request handshake
    end
    Bootstrap->>Settings: Publish effective settings
    alt embed is present
        Bootstrap->>Bootstrap: Do not persist settings
        Host-->>Bootstrap: Later configuration message
        Bootstrap->>Settings: Apply in-memory override
    else embed is absent
        Bootstrap->>Bootstrap: Persist settings normally
        Bootstrap->>Bootstrap: Do not install embedded update listener
    end
```

`getSdkConfig` and `embed` are independent flags. `getSdkConfig` alone triggers the initial `CONFIG_REQUESTED` handshake. `embed` suppresses persistence and enables the listener for subsequent configuration messages. Merely embedding the iframe does not initiate the request handshake unless `getSdkConfig` is also present.

## Source anchors

- `src/Bootstrap.tsx`
- `src/components/Shell/Shell.tsx`
- `src/contexts/ShellContext.ts`
- `src/components/Room/Room.tsx`
- `src/components/Room/useRoom.ts`
- `src/hooks/usePeerAction.ts`
- `src/lib/PeerRoom/PeerRoom.ts`
- `src/services/FileTransfer/FileTransfer.ts`
- `src/pages/PublicRoom/PublicRoom.tsx`
- `src/pages/PrivateRoom/PrivateRoom.tsx`
