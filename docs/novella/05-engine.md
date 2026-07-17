# 05 — Pure deterministic transport-safe engine

> **Revision 12 changes:** engine semantics remain pure; surrounding code now serializes validated output with RFC 8785 and generation-fences checkpoint publication.

The engine imports no React, storage, transport, DOM, global randomness, hashing API, or implicit clock. It receives a validated story and explicit dependencies and never mutates input.

## Operations

- `start(sessionId, controllerPeerId, epoch)` creates revision 0 at the manifest start entry;
- `advance` follows explicit/implicit transitions and refuses unresolved required choices;
- `choose` validates availability, applies immutable effects, and moves to target;
- `restart` preserves session/controller/epoch and increments revision;
- `changeController` preserves story/session/epoch and increments revision;
- getters assert exact story compatibility and referenced content.

## Guard order

Before exposing changed state, enforce variable count/bytes, finite numbers, safe integers, bounded strings/history, and valid story references. Failed guards throw before mutation.

## Distributed boundary

```text
engine output
→ fresh structural normalization
→ semantic validation
→ RFC 8785 canonical bytes
→ domain-separated SHA-256 digest
→ lock-scoped metadata/floor/store install
→ generation-fenced checkpoint side effect
```

`updatedAt` remains diagnostic and is absent from the semantic object.

## Determinism tests

- starts, endings, restart, controller change, explicit and implicit next;
- gated/dead-end choices and effect failures;
- overflow leaves input unchanged;
- random walks yield identical RFC 8785 bytes and digests;
- browser and Node JCS fixtures match;
- every accepted transition advances floor in its transaction;
- old generation checkpoint publication is rejected.
