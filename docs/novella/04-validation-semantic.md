# 04 — Semantic validation: stories, states, transitions, outcomes, and checkpoints

> **Revision 13 changes:** validates transition origin separately from mutable current outcome, compact predecessor proofs, transcript-derived controller changes, and immutable checkpoint records.

## Session against story

`validateSessionAgainstStory` resolves exact `(storyId, storyVersion)` and verifies current scene/entry, history references and strictly increasing revisions, choice/effect validity, variable types and limits, controller/session/epoch/revision constraints, and immutable inputs.

## Complete-state entry points

Normalize, resolve story, validate, JCS-serialize, and digest:

- start proposals and committed/gossip start state;
- reconciliation state;
- snapshots and recovery candidates;
- `SESSION_STARTED`, restart, and election advertisement state;
- winning migration state before deterministic controller change;
- checkpoints;
- supersession-recovered snapshots;
- lineage last-applied states.

Compact transition certificates carry floors/digests, not complete origin states. Their complete state is verified when the epoch is first committed or later recovered by digest. A same-epoch different-session reconciliation must carry the competing compact origin transition so a winning state can replace the active slot atomically.

## Immutable session identity

Two states sharing `(sessionId, sessionEpoch)` require exact story ID/version equality before comparison or engine use. A new story requires a new session and authorized new-epoch transition.

## Floor semantics

State and floor compare the same priority tuple.

- below floor: stale;
- equal priority: exact digest;
- above floor: install only through an authorized complete-state path;
- equal digest plus unequal complete JCS bytes: durable collision lock;
- floor-only receiver may reject a lower incoming state, send floor evidence, and request the complete canonical state.

## Transition origin semantics

- successor origin floor is revision 0 and resolves its exact story;
- start-decision certificate binds coordinator/action ID to successor subject and digest;
- session-started certificate binds predecessor subject/revision/controller/action ID to successor subject and digest;
- switch predecessor was active at transition time;
- start-after-ended predecessor was ended and embeds its exact completed-end certificate;
- transition chain may cross stories/sessions but epochs are contiguous;
- historical slots are sealed; only the active high-water slot may be replaced by a comparator-winning same-epoch different-session origin.

## Current outcome semantics

Current outcome and final transition are related by identity and dominance:

```text
same epoch/session/story
current floor >= successor origin floor
```

An active outcome has matching active origin. An ended outcome may have a later floor than revision 0, has null origin, and requires current exact end evidence. Neither progression nor end rewrites the transition.

## Supersession/safety proof semantics

After complete page assembly:

- proof begins immediately after requested epoch;
- proof ends at advertised current epoch;
- final transition identifies the current subject;
- current outcome dominates final origin floor;
- active evidence contains matching origin and no end certificate;
- ended evidence contains null origin and exact end certificate;
- active receiver enters floor-only recovery until exact/higher authorized state arrives.

A proof may be valid but stale if local high water already exceeds its final epoch; local current metadata wins and the proof is discarded idempotently.

## Migration transcript semantics

Each advertisement summary carries enough priority fields to compare without full state. The transcript winner is deterministic. `winningState` must exactly match the winning summary. Receiver derives the new controller state by calling the pure `changeController` engine operation with the winning candidate, then validates/digests the result before comparison and install.

## Coherent checkpoint semantics

Bootstrap receives emergency state, metadata, pointer, and immutable record from one coherent snapshot.

- active candidate: exact current subject and not below floor;
- authoritative stale: older generation/epoch, noncanonical session, terminal subject, or pointer token not current;
- blocking contradiction: checkpoint above same-generation high water, immutable-story mismatch, impossible floor relation, or pointer-record identity mismatch;
- stale immutable records remain harmless garbage until bounded collection.

## Tests

- progressed successor and ended successor validate against revision-0 transition;
- start-after-ended remains valid after standalone historical certificate removal;
- full/floor ordering equivalence;
- floor-only lower incoming response;
- transcript winner and locally derived controller-change state;
- generation-specific pointer/record mismatch;
- unknown story/version enters recoverable lobby.
