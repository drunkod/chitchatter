# 05 — Pure transport-safe engine

> **Revision 11 changes:** engine semantics remain pure; the plan now makes digest computation an explicit post-engine validation step and requires every exposed transition to advance the persisted digest floor atomically.

The engine imports no React, storage, transport, DOM, global clock, randomness, or hashing API. It receives a validated story and explicit dependencies and never mutates input.

## Operations

- `start(sessionId, controllerPeerId, epoch)` creates revision 0 at the manifest start entry;
- `advance` follows explicit/implicit transitions and refuses required or fully gated choices;
- `choose` validates choice availability, applies immutable effects, and moves to target;
- `restart` preserves session/controller/epoch and increments revision;
- `changeController` preserves story content and increments revision;
- getters assert exact story compatibility and referenced scene/entry existence.

## Transport safety

Before returning changed state, enforce variable count/bytes, finite numbers, bounded strings, bounded history, and safe revisions. A failed guard throws before mutation. Snapshot conversion later truncates history and final validators enforce aggregate budgets.

## Digest boundary

The engine does not decide distributed priority. After engine output:

```text
normalize returned state
→ semantic validation
→ canonicalStateBytes
→ SHA-256 state digest
→ lock-scoped floor/state transaction
```

`updatedAt` remains diagnostic and is excluded from semantic bytes. The canonical event envelope still provides one shared timestamp during normal progression.

## Determinism

Given identical normalized manifest, input state, requested action, and injected clock, the engine returns byte-identical semantic state. Replicas replay progression and compare scene/entry/variables plus computed digest before application.

## Tests

- starts, endings, explicit next, restart, controller change;
- gated/unavailable/dead-end choices;
- string/boolean/numeric effects and nonfinite rejection;
- variable/history/byte overflow leaves state unchanged;
- deterministic random walks produce equal canonical bytes and SHA-256 digests;
- every accepted engine transition advances outcome floor in its surrounding transaction;
- collision-test hook never causes arbitrary state selection.
