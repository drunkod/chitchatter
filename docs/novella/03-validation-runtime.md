# 03 — Runtime structural validation and normalization

> **Revision 10 changes:** validates canonical floors, symmetric conflict descriptors, migration lineage, high-water dominance, structured retirement gossip, and immutable same-session story identity.

## Envelope order

1. reject over-budget encoded input;
2. validate protocol, action, primitive fields, timestamp, and revision;
3. select and normalize the discriminated payload;
4. cross-check outer scope with embedded content;
5. drop unknown fields and MVP `proof`;
6. return fresh objects;
7. run semantic story validation separately.

## Start and reconciliation

- start decisions are revision 0 and have a recomputed deterministic decision ID;
- `START_COMMITTED` outer sender equals the coordinator;
- start gossip holder may differ from embedded coordinator;
- gossip known state shares decision session, epoch, story ID/version and has revision >= 0;
- conflict descriptor state digests and session IDs are canonical bytewise pairs;
- recompute `conflictId` from kind, epoch, sorted session IDs, optional migration ID, and sorted digests;
- incoming state digest must equal one descriptor digest;
- the receiver’s comparator baseline digest must equal the other descriptor digest;
- different-session reconciliation requires a matching revision-0 decision for the incoming session/epoch/story;
- same-session reconciliation requires exact story ID/version equality;
- migration conflicts require a migration ID present in the retained lineage.

A peer may validate and create the runtime conflict record from the first valid reconcile envelope; a pre-existing local record is not required.

## Completed-end certificate

Require the certificate’s session, epoch, story ID/version to equal the embedded original `SESSION_ENDED` envelope and require:

```ts
end.payload.sessionEpoch === certificate.sessionEpoch
```

The original end is live-session scoped and exact-next revision. End gossip is bootstrap-scoped/revision 0 and identifies the holder only.

## Session disposition

`SESSION_RETIREMENT_GOSSIP` is bootstrap-scoped/revision 0. Normalize the exact disposition. The holder need not equal `decidedByActionId`’s sender.

- `ended` disposition requires a matching completed certificate before it is treated as terminal;
- `switched` is terminal for the exact session;
- `reconciled` is nonterminal while its epoch is the active high-water epoch;
- any disposition from an older epoch is terminal because high water supersedes it.

## Migration lineage

- lineage entries are sorted and unique by `(openedAtRevision, migrationId)`;
- each migration ID binds epoch, session, departed controller, and opening revision;
- every entry shares lineage epoch/session;
- `lastAppliedState`, when present, shares lineage epoch/session/story;
- `CONTROLLER_CHANGED.migrationId` selects an existing lineage entry;
- announced state session/epoch/story matches the lineage and active outcome;
- electorate is sorted, unique, bounded, excludes departed controller, and selects the minimum member as announced controller.

## Canonical floor

Validate all IDs, epoch/revision, state digest format, and exact consistency:

- floor epoch/session equals outcome epoch/canonical session;
- floor story identity is nonempty and valid;
- active decision and migration last states cannot be above the floor unless the same metadata mutation also advances the floor;
- when a full state is available with the same priority fields as the floor, its canonical digest must match.

## RoomMeta normalization

Reject:

- any historical record, active record, lineage entry, or floor epoch greater than high water;
- high water 0 with any historical or active record;
- nonzero high water without a matching outcome;
- outcome/floor epoch or session mismatch;
- ended outcome with active decision or migration lineage;
- active decision/lineage different from active outcome;
- duplicate or noncanonical dispositions/certificates/lineage entries;
- certificate without exact ended disposition;
- active canonical session with terminal disposition while outcome is active;
- current-epoch dispositions, certificates, or lineage beyond configured bounds;
- malformed final generation or byte budget.

Malformed RoomMeta blocks receiver attachment. Authoritative-stale checkpoints do not.

## Required tests

- alias-free normalization for every action and durable record;
- symmetric conflict ID from opposite state order;
- first reconcile message creates a verifiable conflict;
- same session/epoch with different story ID/version rejects;
- certificate epoch/story/action binding;
- structured retirement holder identity;
- lineage with two sequential departures;
- every high-water dominance contradiction;
- current-epoch bound overflow rejection;
- canonical floor mismatch and digest tampering.
