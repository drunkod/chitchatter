# 04 — Semantic validation: stories and replicated sessions

> **Revision 10 changes:** enforces immutable story identity within a session, validates floor/full-state consistency, and distinguishes stale checkpoints from blocking contradictions.

## Session against story

`validateSessionAgainstStory` resolves the exact bundled `(storyId, storyVersion)` and verifies:

- current scene and dialogue entry;
- every history scene, entry, and choice;
- strictly increasing history revisions below current revision;
- variable names/types and effect-reachable bounds;
- controller/session/epoch/revision primitive constraints;
- no mutation of input.

## Mandatory full-state entry points

Run structural normalization, resolve the exact story, and semantic validation for:

- start proposal, decision, and decision gossip states;
- reconciliation state;
- state snapshot;
- session switch and restart state;
- election advertisement and controller-changed state;
- persisted checkpoint;
- active start decision state;
- every migration-lineage `lastAppliedState`.

End certificates and dispositions carry no new story state, but their story identity must be a valid ID/version pair and match related records.

## Immutable session story identity

For two states sharing `(sessionId, sessionEpoch)`, require exact equality of `storyId` and `storyVersion` before comparator use. A story change requires a new session and authorized start/switch path.

A conflict descriptor for the same session cannot bridge stories. A different-session conflict may compare different stories because the start decision identifies the incoming session.

## Floor consistency

When full state and outcome floor refer to the same session/epoch:

- state below floor is stale;
- equal priority fields require exact digest equality;
- state above floor may be accepted only by an authorized full-state handler;
- checkpoint above the floor is an impossible safety contradiction and blocks bootstrap;
- checkpoint below/equal floor is continuity evidence only.

## Checkpoint classification

Bootstrap classifies a structurally and semantically valid checkpoint:

- **active candidate:** exact active outcome session/epoch/story and not below an unavailable floor;
- **authoritative stale:** older epoch, terminally disposed session, noncanonical session selected by an active outcome, or exact disposition superseded by metadata;
- **blocking contradiction:** checkpoint epoch above high water, same canonical session with different story identity, or digest/priority impossible relative to the floor.

Authoritative-stale checkpoints are discarded and their latest pointer is cleared best-effort. They never block the receiver. Malformed checkpoints are quarantined and reported; malformed RoomMeta remains blocking.

## Story validation

Story manifests remain deeply normalized and bounded: scenes, entries, choices, assets, transitions, conditions, effects, same-origin extensions, variable widths/counts, and total bytes. Warn about unreachable or fully gated content. The engine rejects the first nonfinite/oversized runtime result before mutation.

## Tests

- same session/epoch with changed story/version rejected at every full-state path;
- floor equality requires exact digest;
- state below floor rejected;
- authoritative-stale retired checkpoint is discarded;
- checkpoint above high water blocks;
- unknown story/version yields recoverable blocking lobby;
- alias-free story/session normalization and effect limits.
