# 05 — Pure transport-safe engine

> **Revision 13 changes:** migration now transports one winning pre-change state and derives controller change locally, preserving the one-state envelope budget.

The engine imports no React, storage, transport, DOM, global clock, randomness, hashing, or serialization API. It receives validated inputs and explicit dependencies and never mutates input.

## Operations

- `start(sessionId, controllerPeerId, epoch)` creates revision 0;
- `advance` follows explicit/implicit transitions and refuses unavailable required choices;
- `choose` validates choice availability, applies immutable effects, and moves to target;
- `restart` preserves session/controller/epoch and increments revision;
- `changeController(state, newControllerPeerId)` preserves story content and increments revision exactly once;
- getters assert exact story compatibility and referenced scene/entry existence.

## Transport and size safety

Before returning state, enforce variable/history/string/number/revision bounds. A failed guard throws before mutation. Snapshot conversion truncates history and final validators enforce aggregate byte budgets.

`CONTROLLER_CHANGED` carries the winning pre-change state only. Every receiver validates it, runs `changeController` with the transcript winner, validates/JCS-digests the deterministic result, and compares that result against its current baseline.

## Digest boundary

```text
engine output
→ structural normalization
→ semantic validation
→ RFC 8785 bytes
→ SHA-256 state digest
→ room-lock floor/state transaction
```

`updatedAt` is diagnostic and excluded from semantic bytes. Normal progression uses one shared envelope timestamp.

## Determinism tests

- starts, transitions, choices, restart, controller change;
- gated/dead-end choices;
- numeric/string/boolean effects and nonfinite rejection;
- overflow leaves input unchanged;
- browser/Node deterministic walks produce equal JCS bytes and digests;
- every peer derives the same controller-change state from transcript winner;
- one maximum legal state plus migration transcript remains within envelope budget.
