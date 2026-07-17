# 06 — Bundled example story and catalog

> **Revision 10 changes:** no protocol change. The example and catalog tests now verify immutable story identity and deterministic state digests across reload/reconciliation fixtures.

Ship one small bundled declarative story under `src/data/visualNovel/` with:

- stable `storyId` and semantic `storyVersion`;
- at least two scenes;
- dialogue, an explicit branch choice, conditions, variable effects, restart, and two endings;
- local image/audio assets referenced by logical IDs;
- no remote executable content or raw HTML.

## Catalog

The catalog resolves only exact bundled `(storyId, storyVersion)` pairs. It exposes immutable normalized manifests and rejects aliases, duplicate IDs, unsupported versions, or mutable caller references.

A session never changes catalog identity. Updating a story creates a new version and therefore requires a new session through start/switch.

## Fixtures

Provide deterministic fixtures for:

- revision-0 start state;
- two equal-revision divergent branches in the same session/story;
- two competing sessions at one epoch;
- progression states at revisions 1, 10, and 20;
- controller changes after two sequential departures;
- ended/switched/reconciled dispositions;
- canonical floors and state digests;
- a stale retired checkpoint;
- a same-session different-story invalid state.

## Tests

- manifest normalization and byte budgets;
- every scene/entry/choice/asset resolves;
- both endings are reachable;
- fixture state digests are stable across object insertion order;
- same session with a different story/version fails;
- snapshot truncation preserves current state and protocol order.
