# UI architecture

This document explains how the visible application is created, how routes are placed inside the persistent shell, and how a room switches between chat and media layouts.

## 1. Browser startup and UI initialization

`src/index.tsx` mounts `Init`. `Init` checks browser support, creates the user's cryptographic key pair and initial settings, and lazy-loads `Bootstrap`. `Bootstrap` merges initial, persisted, and optional SDK-provided settings before rendering the app.

```mermaid
flowchart TD
    Browser[Browser loads application] --> Index[src/index.tsx]
    Index --> Init[Init]
    Init --> Supported{Environment supported?}
    Supported -- No --> Unsupported[EnvironmentUnsupportedDialog]
    Supported -- Yes --> Keys[Generate public and private keys]
    Keys --> Initial[Create initial user settings and user ID]
    Initial --> Lazy[Lazy-load Bootstrap]
    Lazy --> Persisted[Load and migrate IndexedDB settings]
    Persisted --> Embedded{SDK configuration requested?}
    Embedded -- Yes --> Parent[Request configuration from parent frame]
    Parent --> Merge[Merge effective user settings]
    Embedded -- No --> Merge
    Merge --> Providers[Query, router, storage, and settings providers]
    Providers --> Shell[Persistent Shell]
```

While keys or settings are loading, the UI displays `WholePageLoading`. Embedded mode can override settings through `window.postMessage`; embedded settings are not persisted by `Bootstrap`.

## 2. Route and shell composition

`Bootstrap` owns route selection, while `Shell` owns the persistent chrome around every route. This separation lets pages focus on page content while the shell retains peer state, alerts, navigation, dialogs, and responsive sidebar state.

```mermaid
flowchart TD
    Bootstrap[Bootstrap] --> Query[QueryClientProvider]
    Query --> Router[BrowserRouter or HashRouter]
    Router --> Storage[StorageContext]
    Storage --> Settings[SettingsContext]
    Settings --> Shell[Shell and ShellContext]

    Shell --> AppBar[ShellAppBar]
    Shell --> Left[Navigation Drawer]
    Shell --> Main[RouteContent]
    Shell --> Right[PeerList drawer]
    Shell --> Alerts[NotificationArea]
    Shell --> Dialogs[Upgrade, QR, sharing, and connection dialogs]

    Main --> Routes{Active route}
    Routes --> Home[Home]
    Routes --> About[About]
    Routes --> Disclaimer[Disclaimer]
    Routes --> SettingsPage[Settings]
    Routes --> Public[PublicRoom]
    Routes --> Private[PrivateRoom]
```

### Shell responsibilities

- `ShellAppBar` toggles navigation, peer list, room controls, sharing, and fullscreen behavior.
- `Drawer` provides primary navigation and is omitted in embedded mode.
- `RouteContent` adjusts its left and right margins as the persistent drawers open or close.
- `PeerList` shows local and remote peer state, connection type, and audio information.
- `ShellContext` keeps shell and room state alive while route content changes.
- On large screens, sidebars default to open; smaller screens default to a content-first layout.

## 3. Home-to-room navigation

The home page generates or accepts a room name and directs the user to a public or private room route. It also exposes embed-code and enhanced-connectivity controls.

```mermaid
flowchart TD
    Home[Home page] --> RoomName[Generate or edit room name]
    RoomName --> Type[Choose UUID or passphrase name]
    Type --> Choice{User action}
    Choice -- Public --> PublicRoute[Public room route]
    Choice -- Private --> PrivateRoute[Private room route]
    Choice -- Embed --> EmbedDialog[EmbedCodeDialog]
    PublicRoute --> ThrottleA[Throttle rapid room remounts]
    PrivateRoute --> ThrottleB[Throttle rapid room remounts]
    ThrottleA --> RoomA[Room]
    ThrottleB --> Secret{Secret available?}
    Secret -- No --> Prompt[PasswordPrompt]
    Prompt --> Derive[Encode password with room ID]
    Derive --> RoomB[Room with derived secret]
    Secret -- Yes --> RoomB
```

Private-room secrets may arrive in the URL fragment. The page removes the secret from the visible address bar before mounting the room. If no secret is available, it prompts for a password and derives the room secret locally.

## 4. Room UI composition

`Room` first fetches TURN configuration when enhanced connectivity is enabled. `RoomCore` then calls `useRoom`, provides `RoomContext`, and renders controls and content based on current room state.

```mermaid
flowchart TD
    Room[Room] --> Turn[useTurnConfig]
    Turn --> Loading{Configuration loading?}
    Loading -- Yes --> Spinner[WholePageLoading]
    Loading -- No --> Core[RoomCore]
    Core --> Hook[useRoom]
    Hook --> Context[RoomContext.Provider]

    Context --> Controls{Group room and controls visible?}
    Controls -- Yes --> Audio[Audio controls]
    Controls -- Yes --> Video[Video controls]
    Controls -- Yes --> Screen[Screen-share controls]
    Controls -- Yes --> Files[File-upload controls]
    Controls -- Yes --> Toggle[Message visibility control]

    Context --> Media{Any local or peer media stream?}
    Media -- Yes --> Display[RoomVideoDisplay]
    Context --> Messages{Messages visible?}
    Messages -- Yes --> Transcript[ChatTranscript]
    Messages -- Yes --> Form[MessageForm]
    Messages -- Yes --> Typing[TypingStatusBar]
```

Direct-message rooms suppress the group-room media control strip. The message and stream state still comes from the same room orchestration layer, but actions use a direct-message namespace and target a specific peer.

## 5. Responsive room layout

```mermaid
flowchart TD
    Size[Observe window width and height] --> Orientation{Width greater than height?}
    Orientation -- Yes --> Landscape[Landscape]
    Orientation -- No --> Portrait[Portrait]
    Landscape --> SideBySide[Video fills flexible area; chat uses 400px column]
    Portrait --> Stacked[Video and chat stack vertically]
    Stacked --> Both{Video and messages visible?}
    Both -- Yes --> Split[Video 60 percent; messages 40 percent]
    Both -- No --> Full[Visible panel uses full height]
```

When no media streams exist, messages are forced visible so the room cannot become an empty screen.

## Source anchors

- `src/index.tsx`
- `src/Init.tsx`
- `src/Bootstrap.tsx`
- `src/components/Shell/Shell.tsx`
- `src/components/Shell/RouteContent.tsx`
- `src/pages/Home/Home.tsx`
- `src/pages/PublicRoom/PublicRoom.tsx`
- `src/pages/PrivateRoom/PrivateRoom.tsx`
- `src/components/Room/Room.tsx`
