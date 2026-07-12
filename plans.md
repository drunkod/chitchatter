# Novella plans index

The original single-file plan has been split into focused, implementation-level guides. Start with the architecture, then follow the numbered documents in order.

| Guide | Purpose |
| --- | --- |
| [`docs/novella/00-overview.md`](docs/novella/00-overview.md) | Scope, repository assessment, decisions, milestones, and definition of done |
| [`docs/novella/01-models-and-validation.md`](docs/novella/01-models-and-validation.md) | Complete story/session/protocol types, limits, and runtime validation |
| [`docs/novella/02-engine-and-example-story.md`](docs/novella/02-engine-and-example-story.md) | Framework-independent engine and a complete branching JSON story |
| [`docs/novella/03-p2p-protocol-and-sync.md`](docs/novella/03-p2p-protocol-and-sync.md) | Existing `PeerRoom` integration, requests, canonical events, snapshots, and election |
| [`docs/novella/04-react-ui-and-room-integration.md`](docs/novella/04-react-ui-and-room-integration.md) | Context, hooks, components, responsive layout, and accessibility |
| [`docs/novella/05-assets-audio-and-persistence.md`](docs/novella/05-assets-audio-and-persistence.md) | Safe assets, preloading, local music/SFX, and provisional checkpoints |
| [`docs/novella/06-tests-and-rollout.md`](docs/novella/06-tests-and-rollout.md) | Unit, hook, UI, E2E, manual validation, rollout, and README work |

## Recommended sequence

1. Implement models, limits, and validators.
2. Implement and unit-test the pure engine with the bundled example story.
3. Add one short existing-transport action and the synchronization service.
4. Add late join, revision recovery, and controller migration.
5. Add the React provider, stage, lobby, controls, and responsive room layout.
6. Add asset/audio/checkpoint behavior.
7. Complete regression, multi-peer E2E, security, and documentation gates.

No guide introduces a central game-state server, user accounts, analytics, or a second WebRTC room.

