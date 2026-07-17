# 05 — Pure engine

> **Revision 10 changes:** no transition semantics change. The plan now requires every accepted engine result to advance the durable comparator floor in the same transaction that exposes state.

The engine imports no React, storage, transport, DOM, global clock, or randomness. It receives a validated manifest and explicit dependencies.

## Operations

- `start(sessionId, controllerPeerId, sessionEpoch)` creates revision 0 at the manifest start entry;
- `advance` follows legal next transitions and refuses to skip required choices;
- `choose` validates availability, applies immutable effects, and moves to the target;
- `restart` preserves session/controller/epoch/story and increments revision;
- `changeController` preserves session/epoch/story/content and increments revision;
- getters assert exact story compatibility.

## Transport safety

Before returning a changed state, enforce variable count/bytes, finite numbers, bounded history, valid IDs, and snapshot/envelope fit. Failure occurs before mutation.

## Determinism

Given the same normalized manifest, state, action, and injected timestamp, the engine emits byte-equivalent semantic state. `updatedAt` is diagnostic and excluded from distributed ordering.

Replicas replay progression and compare derived scene, entry, variables, history suffix, revision, and immutable story identity before application.

## Integration contract

An engine result is not canonical merely because it is locally valid. The sync layer must:

1. authorize the action;
2. compute `floorFromState(result)`;
3. run a lock-scoped metadata/state transaction that advances the floor and installs the exact result;
4. broadcast/commit only after success.

## Tests

- starts, endings, next links, restart, controller change;
- required/unavailable/dead-end choices;
- string/boolean/numeric effects and nonfinite rejection;
- variable/history/byte overflow leaves state unchanged;
- story identity preserved by every operation;
- deterministic random walks whose states and floors pass validators.
