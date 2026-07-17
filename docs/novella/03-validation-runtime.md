# 03 — Runtime structural validation and normalization

> **Revision 12 changes:** validates RFC 8785 inputs, contiguous transition certificates, supersession chains, safety-recovery exceptions, lineage-bound advertisements, and generation-fenced checkpoints.

## Envelope pipeline

1. reject encoded input above the envelope budget before deep traversal;
2. validate protocol/action/primitive fields;
3. normalize the discriminated payload into fresh objects;
4. cross-check outer subject scope and transport sender identity;
5. drop unknown fields and MVP `proof`;
6. run semantic story/state validation;
7. serialize complete states with RFC 8785 and compute the exact SHA-256 digest.

## RFC 8785 prerequisites

Reject complete states containing:

- lone UTF-16 surrogates;
- nonfinite numeric values;
- unsafe integer fields;
- unsupported value types;
- unknown semantic-state properties after normalization.

Tests must include official-style JCS fixtures plus project fixtures for control escapes, non-ASCII strings, `-0`, exponent thresholds, and property order.

## Transition certificates

Validate every `EpochTransitionCertificate`:

- `initial-start` is epoch 1 with `predecessorOutcome: null`;
- later transitions have predecessor epoch exactly `successor.epoch - 1`;
- transition array is contiguous from epoch 1 through `highWaterEpoch`;
- successor outcome is active and its floor revision is 0;
- start-decision origin exactly matches successor floor/session/story;
- session-started certificate contains the full normalized original envelope;
- `SESSION_STARTED` outer sender equals the predecessor controller and payload predecessor subject/revision matches the prior outcome/state authorization;
- transition ID recomputes from all normalized raw fields;
- switch disposition evidence ID equals its transition ID.

## Supersession chains

For `SESSION_SUPERSESSION_GOSSIP` and `SAFETY_RECOVERY_GOSSIP`:

- requested subject matches the stale envelope/request being answered;
- transition list is nonempty, bounded, contiguous, and begins after the requested epoch;
- every certificate validates independently;
- final transition successor equals `currentOutcome`;
- active current outcome has matching `currentOrigin` and no end certificate;
- ended current outcome has null origin and exact end certificate;
- current known state, when present, exactly matches floor priority and digest.

A chain may advance over several switches or a start-after-ended transition. It never rewrites historical transition IDs.

## Conflict descriptor modes

- descriptor IDs and digests are canonically ordered and recomputed;
- incoming digest belongs to the descriptor;
- migration kind selects a retained lineage record;
- exact mode requires latest baseline digest to be the other digest;
- stale mode accepts the descriptor only as correlation and rebases against latest state/floor;
- floor-only stale mode may return `STATE_FLOOR_GOSSIP` instead of a complete winner.

## Migration envelopes

`ELECTION_ADVERTISE` and `CONTROLLER_CHANGED` both require:

- `migrationId`, departed controller, and opening revision matching one retained record;
- round ID recomputed from migration ID, epoch/session, departed controller, opening revision, electorate where applicable, controller, and state digest;
- same session/epoch/story as lineage and active outcome;
- current peer presence does not invalidate an already-retained migration record.

Transport absence is checked only when opening a new migration record.

## Dispositions and end evidence

- ended disposition enters RoomMeta only atomically with its exact completed certificate;
- retirement gossip carrying ended is rejected;
- switched disposition must match one retained transition certificate;
- reconciled logical key is `(epoch, sessionId, reason)` and merges by bytewise-minimum conflict ID;
- ended/switched conflicting evidence IDs are blocking contradictions.

## RoomMeta normalization

Reject:

- nonzero high water without exactly `highWaterEpoch` contiguous transition certificates;
- transition predecessor/successor discontinuity;
- outcome/floor/current-origin mismatch;
- switched disposition with missing/mismatched transition;
- ended disposition/certificate mismatch;
- lineage inconsistent with active outcome;
- migration advertisements referring to no lineage record;
- any durable epoch above high water;
- operational metadata above `maxOperationalRoomMetaBytes` without a durable safety lock;
- total metadata above `maxRoomMetaBytes`;
- malformed or impermissibly cleared durable safety lock;
- duplicate/noncanonical evidence;
- invalid generation or checkpoint token fields.

Malformed RoomMeta blocks receiver attachment. Runtime capability/storage states are separate from RoomMeta validation.

## Required tests

- RFC 8785 string/number/property fixtures in browser and Node;
- A→B→C transition chain and A→B then B ended;
- transition ID/action-state mix-and-match rejection;
- interleaved advertisements for two migration IDs;
- controller rejoin does not invalidate retained lineage;
- stale below-high-water supersession chain validation;
- capacity lock fits reserved metadata headroom;
- checkpoint pointer generation/floor mismatch rejection;
- exact, stale-full-state, and stale-floor-only conflict modes;
- alias-free normalization for every action and record.
