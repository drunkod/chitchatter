# 04 — Semantic validation: stories and replicated sessions

> **Revision 8 changes:** adds completed-end gossip boundaries and requires the bootstrap checkpoint baseline, active start state, active migration state, and every reconciliation state to be semantically validated before receiver attachment or application.

## Session against story

`validateSessionAgainstStory` verifies exact story ID/version, current scene/entry, every history scene/entry/choice, strictly increasing history revisions, and history revisions below current revision. It returns errors rather than throwing and never mutates input.

## Mandatory full-state entry points

Run structural normalization, resolve the exact bundled story/version, then semantic validation before authorization/application for:

- `STATE_SNAPSHOT`, `SESSION_STARTED`, `RESTARTED`;
- `START_PROPOSE.candidate`, `START_COMMITTED.decision.state`;
- both states in `START_DECISION_GOSSIP`;
- `SESSION_RECONCILE.state`;
- `ELECTION_ADVERTISE.state`, `CONTROLLER_CHANGED.state`;
- persisted latest checkpoint;
- `RoomMeta.activeStartDecision.state`;
- `RoomMeta.activeMigration.lastAppliedState` when present.

`SESSION_END_NOTICE_GOSSIP` has no new story state; its embedded original end envelope and persisted scope are structurally validated in 03. Applying it only tombstones/clears an exact session and epoch.

Unknown story/version is a recoverable blocking lobby state, never a render-time engine exception.

## Story validation

`validateStory` remains deep and normalizing. It bounds total size, scenes/dialogue/choices/assets, validates all IDs and map keys, transitions, choice targets, asset references, conditions, effects, same-origin extensions, and effect-reachable variable names/value width. It warns about all-gated choices without fallback and conservative large increments in cycles.

Static validation cannot prove arbitrary numeric loops terminate before overflow. The engine rejects the first invalid result before mutation. That is an authoring/runtime error for one action, not an untransmittable canonical state.

## Tests

- unknown live/history scene, entry, or choice;
- incoherent history revisions;
- missing bundled story/version at every full-state entry point;
- invalid persisted active start/migration baseline blocks ready runtime;
- reconciliation and gossip state never reaches `setState` on semantic failure;
- story normalization is alias-free and effect limits are enforced.
