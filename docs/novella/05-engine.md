# 05 — Pure engine

> **Revision 8 changes:** no functional engine change. The plan now clarifies that distributed reconciliation compares normalized semantic state excluding diagnostic `updatedAt`; engine determinism and transport-limit enforcement remain unchanged.

The engine owns legal story transitions and imports no React, storage, transport, DOM, global clock, or randomness. It receives a validated manifest and explicit dependencies.

## Required operations

- `start(sessionId, controllerPeerId, sessionEpoch)` creates revision 0 at the manifest start entry;
- `advance` follows explicit/implicit next transitions and refuses to skip required or fully gated choices;
- `choose` validates availability, applies immutable effects, and moves to the target scene;
- `restart` preserves session/controller/epoch and increments revision;
- `changeController` preserves story content and increments revision;
- getters assert story compatibility and resolve exact scene/entry.

## Transport safety

Before returning a changed state, the engine verifies:

- variable count <= `maxVariables`;
- encoded variables <= `maxVariablesBytes`;
- every numeric value is finite;
- history is bounded in memory.

A failed guard throws before mutation. Snapshot conversion later truncates history by count and bytes and final validators enforce the full snapshot/envelope budgets.

## Determinism

Given the same normalized manifest, input state, requested action, and injected clock, the engine returns byte-equivalent semantic state. It never mutates input. Replicas replay progression events and compare derived scene/entry/variables before application.

`updatedAt` is diagnostic and excluded from the distributed final tie-break in 01; canonical event envelopes still provide one shared timestamp in normal progression.

## Tests

- starts, both endings, explicit next links, restart, controller change;
- unavailable/required/dead-end choices and `STORY_ENDED`;
- string/boolean/numeric effects and non-finite increment rejection;
- variable count/byte overflow leaves state unchanged;
- history bounding, incompatible stories, missing scenes/entries;
- deterministic immutable random walks where every emitted snapshot passes runtime validation.
