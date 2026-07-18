# Novella MVP

The Novella MVP adds one synchronized visual story to a Chitchatter group room. It reuses the room's existing `PeerRoom` connection and remains deliberately ephemeral: when the room empties, the story is gone just like the chat history.

## Enable the feature

The room integration is behind a build-time flag:

```bash
VITE_ENABLE_NOVELLA=true npm start
```

Join a group room from two browser contexts. The room shows the bundled **Harbour Lights** story above the normal chat and media area.

The standalone M1 preview remains available separately:

```bash
VITE_ENABLE_NOVELLA_DEV=true npm start
```

Then open `http://localhost:3000/?novellaDev=1`.

## MVP behavior

- One active story per group room.
- The peer that starts the story is the storyteller/controller.
- Participant clicks are sent to the controller, which sequences the action and broadcasts the result.
- Late joins, refreshes, and revision gaps recover through a targeted full-state snapshot.
- When the storyteller leaves, the story pauses.
- The lowest connected peer sees **Continue the story** and can claim control with one click.
- Direct-message rooms never mount a novella runtime.
- Chat, camera, audio, screen sharing, and file sharing remain part of the same room UI.

## Deliberate limits

This version has no persistence, checkpoints, epochs, cross-tab coordination, background elections, or cloud progress storage. The UI states this directly: the story lives with the room and disappears when everyone leaves.

The archived Revision 13 documents describe a possible durability layer. They are not MVP requirements.

## Playbooks

Use the narrowest playbook that matches the task:

- [`demo-playbook.md`](./demo-playbook.md) — demonstrate the feature and run the complete human happy-path and recovery checklist.
- [`macbook-human-test-playbook.md`](./macbook-human-test-playbook.md) — set up Node/Nix and local services on macOS, run the detailed multi-browser acceptance flow, collect evidence, execute Playwright, and diagnose Helium ICE restrictions.
- [`release-playbook.md`](./release-playbook.md) — perform the release gate, enabled/disabled build checks, go/no-go decision, limited rollout, and rollback.
- [`failure-injection-playbook.md`](./failure-injection-playbook.md) — exercise delays, simultaneous joins, timeouts, controller departure, refresh, and rapid navigation in disposable rooms.
- [`incident-triage-playbook.md`](./incident-triage-playbook.md) — classify connectivity versus Novella failures, capture evidence, assign severity, reproduce, and close defects.
- [`compatibility-accessibility-playbook.md`](./compatibility-accessibility-playbook.md) — test browser combinations, responsive layouts, keyboard navigation, screen-reader basics, zoom, permissions, and media regressions.

The demo playbook is the release candidate's canonical human walkthrough. The MacBook playbook provides the local environment and browser-specific procedure. The other playbooks extend them without changing the MVP's intentionally ephemeral guarantees.

## Tests

Run the complete gate:

```bash
npm run check:types
npm test -- --run
npm run lint
npm run build
npm run test:e2e
```

Run only the two-browser novella suite:

```bash
npm run test:e2e -- e2e/tests/visual-novel.test.ts
```

The Playwright server enables `VITE_ENABLE_NOVELLA=true`, starts the local tracker, and uses real browser contexts. It starts a deterministic test server by default; reuse of a manually started server is explicit through `PLAYWRIGHT_REUSE_EXISTING_SERVER=true`.

The suite covers:

- both Harbour Lights branches;
- participant-to-controller action round trips;
- late-join and refresh recovery;
- controller leave, pause, claim, and continued progression;
- chat propagation;
- video display compatibility;
- direct-message isolation.

## Implementation map

- `src/models/visualNovel.ts` — story and session models
- `src/services/visualNovel/VisualNovelEngine.ts` — pure deterministic engine
- `src/services/visualNovel/VisualNovelProtocol.ts` — envelope normalization
- `src/services/visualNovel/VisualNovelSession.ts` — controller/replica runtime
- `src/services/visualNovel/PeerRoomVisualNovelTransport.ts` — existing-room adapter
- `src/components/VisualNovelRoom/` — group-room UI
- `src/stories/harbour-lights/` — bundled example story
- `e2e/tests/visual-novel.test.ts` — browser acceptance suite
