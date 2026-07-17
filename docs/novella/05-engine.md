# 05 — Pure engine

> **Revision 9:** no functional engine change. The engine remains deterministic, immutable, and transport-safe; protocol ordering compares semantic state without `updatedAt`.

## Responsibilities

- `start(sessionId, controllerPeerId, sessionEpoch)` creates revision 0;
- `advance` follows validated transitions and refuses to skip required choices;
- `choose` validates availability, applies immutable effects, and moves;
- `restart` preserves session/controller/epoch and increments revision;
- `changeController` preserves story content and increments revision;
- getters assert exact story compatibility.

## Transport safety

Before returning changed state, enforce variable count, encoded variable bytes, finite numeric values, and bounded history. Failed guards throw before mutation. Snapshot conversion later truncates history by count/bytes and final validators enforce full budgets.

## Determinism

Given identical normalized manifest, state, action, and injected clock, replicas derive equivalent semantic state. Progression events are replayed before application. `updatedAt` is diagnostic and excluded from convergence ordering.

## Tests

Cover starts/endings, next links, choices, restart, controller change, effects, non-finite increments, count/byte overflow, history bounds, incompatibility, missing entries, immutability, deterministic random walks, and validator compatibility of every emitted snapshot.
