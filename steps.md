# Novella implementation steps index

The detailed steps and full module examples now live in [`docs/novella/`](docs/novella/00-overview.md).

## Build order

- [ ] [`00-overview.md`](docs/novella/00-overview.md): confirm scope, invariants, extension points, and milestones.
- [ ] [`01-models-and-validation.md`](docs/novella/01-models-and-validation.md): add copy-ready models, limits, safe URL rules, story validation, envelope validation, and payload validation.
- [ ] [`02-engine-and-example-story.md`](docs/novella/02-engine-and-example-story.md): add the deterministic engine, catalog, complete three-scene story, and pure engine tests.
- [ ] [`03-p2p-protocol-and-sync.md`](docs/novella/03-p2p-protocol-and-sync.md): extend the existing action enum, add keyed peer lifecycle cleanup, implement the sync service and React transport hook.
- [ ] [`04-react-ui-and-room-integration.md`](docs/novella/04-react-ui-and-room-integration.md): add provider, lobby, stage, dialogue, choices, controls, and integrate them with `Room.tsx` without breaking chat/audio.
- [ ] [`05-assets-audio-and-persistence.md`](docs/novella/05-assets-audio-and-persistence.md): add asset resolution/preloading, independent local story audio, and optional provisional checkpoints.
- [ ] [`06-tests-and-rollout.md`](docs/novella/06-tests-and-rollout.md): complete unit/integration/E2E tests, manual matrices, command gates, and rollout documentation.

## Full verification command set

```bash
npm test -- --run
npm run check:types
npm run lint
npm run build
npm run test:e2e -- e2e/visual-novel.spec.ts
```

The examples are intentionally split by file boundary so implementation commits can follow the same order.

