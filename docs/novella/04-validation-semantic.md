# 04 — Semantic validation: stories, states, transitions, and checkpoints

> **Revision 12 changes:** adopts exact JCS semantic bytes, validates transition predecessor/successor story semantics, and generation-fences checkpoint classification.

## Session against story

`validateSessionAgainstStory` resolves exact `(storyId, storyVersion)` and verifies current scene/entry, history references and increasing revisions, choices, variables/effects, controller/session/epoch/revision constraints, and immutable inputs.

## Mandatory complete-state entry points

Normalize, resolve story, validate, RFC-8785 serialize, and digest:

- start proposals, decisions, and decision gossip;
- reconciliation state;
- snapshots and floor-recovery candidates;
- `SESSION_STARTED`, restart, election advertisement, and controller-change state;
- checkpoints;
- transition successor origin state;
- migration-lineage last-applied state;
- supersession known state.

## Immutable identity

Two states sharing `(sessionId, sessionEpoch)` require exact story ID/version equality. A new story requires a new session and an authorized epoch transition.

## Floor semantics

State and floor compare the same `(epoch, revision, controller, session, digest)` tuple.

- below floor: stale;
- equal tuple: exact digest required;
- above floor: only an authorized complete-state path may install;
- same digest plus unequal complete JCS bytes: digest-collision lock;
- floor-only receiver may reject a lower state and send `STATE_FLOOR_GOSSIP` while recovering the complete winner.

## Transition semantics

- successor state is revision 0 and resolves its exact story;
- `switch` predecessor must be the then-active session and sender must be its controller;
- `start-after-ended` predecessor outcome must be ended with matching completed certificate in local metadata;
- transition chain may cross different stories and sessions but epochs are contiguous;
- active origin refers to the final transition certificate or initial start decision;
- an ended current outcome may have no active origin while historical transition evidence remains.

## Coherent checkpoint classification

Classification receives metadata, latest pointer, and checkpoint from one `ConsistentBootstrapSnapshot`.

- active candidate: exact current outcome session/story and not below floor;
- authoritative stale: older epoch, noncanonical session, terminally disposed session, or pointer token not current;
- blocking contradiction: checkpoint above same-generation high water, immutable-story mismatch, or impossible floor relation;
- post-transaction pointer publication uses the generation token and cannot make an older checkpoint current.

## Unknown stories

Unknown current outcome/transition/checkpoint story versions enter a recoverable blocking lobby with exact diagnostics. They never reach render-time engine calls.

## Tests

- JCS fixtures and digest fixtures match across runtimes;
- transition chain validates across multiple story switches;
- start-after-ended requires ended predecessor evidence;
- full-state and floor ordering agree;
- same-session story mutation rejects;
- floor-only lower incoming returns floor evidence;
- generation-fenced stale checkpoint remains nonblocking;
- unknown story/version enters recoverable lobby.
