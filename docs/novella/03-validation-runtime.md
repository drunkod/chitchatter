# 03 — Runtime structural validation and normalization

> **Revision 11 changes:** validates the exact SHA-256 digest format, generalized session origins, successor evidence, deterministic disposition upserts, stale-conflict rebasing inputs, and coherent bootstrap snapshots.

## Envelope order

1. reject over-budget encoded input before deep traversal;
2. validate protocol, action, primitive fields, timestamp, and revision;
3. normalize the selected discriminated payload into fresh objects;
4. cross-check outer scope with embedded subject scope;
5. drop unknown fields and MVP `proof`;
6. resolve semantic story validation;
7. compute/cache exact canonical bytes and SHA-256 digest for complete states.

## Digest and comparator inputs

- `stateDigest` is exactly 64 lowercase hex characters;
- recompute it from the Revision 11 domain-separated canonical bytes;
- do not trust supplied digest values;
- complete-state comparison consumes `ValidatedState` wrappers;
- equal digest with different canonical bytes triggers the digest-collision safety lock.

## Session origins

`start-decision` origin validation recomputes the start decision ID and requires revision 0.

`session-started` origin validation requires:

- bounded action/controller IDs;
- embedded state revision 0;
- embedded controller equals the origin controller;
- exact story/session/epoch scope;
- state semantically valid for the bundled story.

`activeOrigin` must match the active outcome. A different-session reconcile carries the incoming origin, whether start decision or switched-session origin.

## Conflict descriptors and rebasing

Validate:

- canonical bytewise order of session IDs and SHA-256 digests;
- recomputed `conflictId` from kind, epoch, ordered IDs, optional migration ID, and ordered digests;
- incoming state digest equals one descriptor digest;
- start conflicts have no migration ID;
- migration conflicts select an ID in retained lineage;
- same-session conflict has exact story identity;
- different-session conflict has valid incoming origin.

Two authorization modes exist:

1. **Exact descriptor:** receiver’s latest baseline digest is the other descriptor digest.
2. **Stale descriptor:** receiver’s baseline advanced. The descriptor is accepted only as correlation; authorization rebases incoming against the latest baseline and derives a fresh descriptor if needed.

A pre-existing runtime conflict record is not required.

## Completed-end certificate

Require certificate session, epoch, story ID/version to equal the embedded original `SESSION_ENDED` envelope and:

```ts
end.payload.sessionEpoch === certificate.sessionEpoch
```

The original end is exact-next revision from the then-current controller. End gossip is bootstrap-scoped/revision 0 and identifies the holder.

## Disposition and successor evidence

Disposition key is `(sessionEpoch, sessionId, reason)`.

- `ended` disposition is persisted only through completed-end certificate processing; retirement gossip carrying `ended` is rejected;
- `switched` retirement gossip requires non-null successor evidence whose outcome epoch is greater than the disposed epoch;
- successor origin exactly matches successor outcome session/epoch/story;
- successor known state, when present, exactly matches the outcome floor digest and priority fields;
- `reconciled` may omit successor; if successor is present, it must describe the current canonical outcome;
- duplicate logical disposition keys merge deterministically:
  - ended/switched conflicting evidence IDs are a blocking contradiction;
  - reconciled uses the bytewise smaller conflict ID as canonical informational evidence.

A switched disposition is never stored at the current active high-water epoch. It is merged in the same transaction that raises the receiver to successor high water.

## Migration lineage

- entries sorted/unique by `(openedAtRevision, migrationId)`;
- migration ID binds epoch, session, departed controller, and opening revision;
- every entry shares lineage session/epoch;
- `lastAppliedState`, when present, shares session/epoch/story;
- controller-changed payload selects one retained migration ID;
- electorate remains sorted, unique, bounded, excludes departed controller, and elects minimum ID.

## RoomMeta normalization

Reject:

- any durable epoch greater than high water;
- high water 0 with protocol evidence;
- nonzero high water without matching outcome;
- outcome/floor mismatch;
- ended outcome with active origin or lineage;
- active origin or lineage inconsistent with outcome;
- certificate without exact ended disposition or ended disposition without certificate;
- switched disposition at high water;
- active canonical session with a terminal disposition;
- duplicate/noncanonical evidence after deterministic upsert;
- current-epoch bound overflow unless the metadata is already in the corresponding safety-lock state;
- malformed safety-lock code;
- invalid generation/byte budget.

Malformed RoomMeta blocks receiver attachment. A valid stale checkpoint does not.

## Required tests

- exact digest domain/encoding and lowercase-hex validation;
- canonical-byte/digest collision hook enters safety lock;
- both origin variants and successor consistency;
- switched notice without successor rejects;
- ended retirement gossip rejects;
- deterministic disposition upsert under opposite delivery order;
- exact and stale conflict descriptor paths;
- high-water and terminality contradictions;
- current-epoch overflow requires safety lock;
- alias-free normalization for every action and record.
