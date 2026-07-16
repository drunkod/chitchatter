# Chitchatter architecture diagrams

This directory explains how the Chitchatter UI is assembled and how the runtime code connects browser state, React contexts, peer-to-peer communication, media, and file transfer.

The diagrams were produced from:

- source commit `c61fe6fefdd5c00db963ce20aad096d04422583d`;
- a local offline Graphify graph in `graphify-out/graph.json` (`720` nodes and `1687` edges at the time of analysis);
- targeted Graphify queries for the startup, shell, room, and `PeerRoom` subgraphs;
- source verification against the files linked in each document;
- the supplied DeepWiki export, used as supporting context rather than as the source of truth.

## Reproducing the Graphify analysis

`graphify-out/` is a local generated artifact and is not committed to this branch. To reproduce the graph at the documented source revision, check out the commit above and run from the repository root:

```bash
nix run /Users/test/nix-config#graphify-extract -- .
nix run /Users/test/nix-config#graphify-query -- "Bootstrap Shell RouteContent Home PublicRoom PrivateRoom Room" --graph ./graphify-out/graph.json
nix run /Users/test/nix-config#graphify-query -- "PeerRoom useRoom RoomContext useRoomAudio useRoomVideo useRoomScreenShare useRoomFileShare" --graph ./graphify-out/graph.json
```

The absolute flake path is specific to the analysis machine. On another machine, replace `/Users/test/nix-config` with the path to the configured `nix-config` flake. A healthy code-only extraction should report `0 docs, 0 papers, 0 images`.

## Documents

1. [UI architecture](ui-architecture.md)
   - startup and route selection;
   - shell layout;
   - home-to-room navigation;
   - room controls, video, chat, and responsive layout.
2. [Codebase and runtime architecture](codebase-runtime.md)
   - major code layers;
   - context ownership;
   - room creation and peer lifecycle;
   - messages, media streams, and file transfer;
   - private-room identity and password handling.

## Reading order

```mermaid
flowchart TD
    A[Browser entry and initialization] --> B[Bootstrap providers and router]
    B --> C[Persistent Shell UI]
    C --> D[Route page]
    D --> E[Room UI]
    E --> F[useRoom orchestration]
    F --> G[PeerRoom and Trystero]
    G --> H[Remote browser peers]
```

For a UI-oriented introduction, start with [UI architecture](ui-architecture.md). For implementation and network behavior, continue with [Codebase and runtime architecture](codebase-runtime.md).
