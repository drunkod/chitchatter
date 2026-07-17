# 04 — Semantic validation: stories, states, floors, origins, and checkpoints

> **Revision 11 changes:** aligns floor ordering with digest ordering, validates successor-origin state, and classifies checkpoints only from a generation-consistent bootstrap snapshot.

## Session against story

`validateSessionAgainstStory` resolves the exact bundled `(storyId, storyVersion)` and verifies current scene/entry, history references and strictly increasing revisions, choices, variables/effects, controller/session/epoch/revision constraints, and immutable input behavior.

## Mandatory complete-state entry points

Normalize, resolve the story, semantically validate, canonicalize, and digest:

- start proposal, decision, and known gossip state;
- reconciliation state;
- state snapshot;
- `SESSION_STARTED` and restart state;
- election advertisement/controller-changed state;
- persisted checkpoint;
- both session-origin variants;
- successor known state;
- migration-lineage last-applied states.

## Immutable session story identity

Two states sharing `(sessionId, sessionEpoch)` require exact `storyId` and `storyVersion` equality before comparator or rebase use. Story change requires a new session and authorized start/switch path.

## Floor consistency

For state and floor at the same session/epoch:

- compare the same epoch/revision/controller/session/digest tuple used by full states;
- below floor is stale;
- equal tuple requires exact digest;
- full-state digest equality also compares canonical bytes to detect an implementation collision;
- above floor needs an authorized complete-state path;
- successor known state must equal its advertised successor floor exactly.

A floor-only peer therefore chooses the same winner as a peer holding the prior full state.

## Origin semantics

- start-decision origin resolves the decision state’s story and revision 0;
- session-started origin resolves its state, controller ownership, and revision 0;
- active origin identifies the same canonical session as outcome;
- incoming different-session reconcile/successor evidence must include an origin for that incoming session.

## Generation-consistent checkpoint classification

Classification receives one `ConsistentBootstrapSnapshot`, never independently read metadata and checkpoint values.

- **active candidate:** exact active outcome session/epoch/story and not below floor;
- **authoritative stale:** older epoch, terminally disposed session, or noncanonical active-epoch session;
- **blocking contradiction:** checkpoint epoch above snapshot high water, immutable-story mismatch, or a digest/priority relation impossible against the same-generation floor.

If the metadata generation changes during bootstrap, discard the entire snapshot and retry before classification. Stale checkpoints are cleared best-effort and never block receiver mount.

## Unknown stories

Unknown outcome/origin/checkpoint story versions produce a recoverable blocking lobby state with exact error details. They never reach render-time engine calls.

## Story validation

Story manifests remain deeply normalized and bounded: IDs, scenes, entries, choices, assets, transitions, conditions, effects, same-origin extensions, variable widths/counts, and total encoded size. Runtime rejects nonfinite/oversized results before mutation.

## Tests

- full-state and floor comparator give identical order for tie cases;
- same session/epoch changed story rejects everywhere;
- both origin variants validate semantically;
- successor known state must equal floor;
- metadata-generation change forces bootstrap retry;
- same-generation above-floor contradiction blocks;
- authoritative stale checkpoint remains nonblocking;
- unknown story/version enters recoverable lobby;
- alias-free story/state normalization.
