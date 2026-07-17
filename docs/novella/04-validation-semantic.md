# 04 — Semantic validation: stories and replicated sessions

> **Revision 9 changes:** semantic bootstrap selection now treats progressed checkpoint/live state as stronger than revision-0 decision evidence.

## State against story

`validateSessionAgainstStory` verifies exact story ID/version, current scene and entry, all history scene/entry/choice references, strictly increasing history revisions, and every history revision below current revision. It returns a normalized result without mutation.

## Mandatory full-state entry points

Run structural normalization, resolve exact bundled story/version, then semantic validation for:

- state snapshots, session starts, restarts;
- start proposals and committed decision state;
- both start-gossip states;
- reconciliation state and optional decision state;
- election advertisements and controller changes;
- persisted latest checkpoint;
- active start decision state;
- active migration last state.

Completed-end gossip contains no new renderable state; its embedded original envelope is structurally bound to the certificate.

## Bootstrap consistency

Validate metadata active-record states and checkpoint independently. Then compute the strongest valid state for the high-water epoch. A checkpoint at revision 10 outranks an active decision’s revision-0 state. Contradictory story/session identities block ready runtime and require explicit recovery/reset.

## Story validation

Keep deep normalization and bounds for manifest size, IDs, scenes, dialogue, choices, assets, transitions, conditions, effects, same-origin paths, and effect-reachable variable count/value width. Warn for all-gated choices without fallback and conservative dangerous numeric cycles.

The engine rejects the first non-finite or over-budget transition before mutation; static analysis does not claim arbitrary loop termination.

## Tests

- invalid live/history references;
- missing exact story/version at every full-state entry;
- rev10 checkpoint chosen over rev0 decision;
- invalid active start/migration state blocks bootstrap;
- semantic-invalid gossip/reconciliation never reaches state application.
