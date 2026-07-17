# 16 — Regression, property, pagination, and failure-injection matrices

> **Revision 13 changes:** adds mutable-outcome dominance, proof pagination at real byte limits, self-contained transition dependencies, reset-only transition capacity, shared election transcripts, exact ID fixtures, and immutable checkpoint races.

## Canonicalization and IDs

- RFC 8785 fixtures for property order, escapes, Unicode, lone surrogates, `-0`, exponent boundaries, and shortest numbers;
- browser/Node equality for state digest;
- browser/Node equality for every derived-ID domain;
- changing any normalized certificate/transcript/page field changes its ID;
- object insertion order and locale never change IDs.

## Transition and outcome

- initial, switch, and start-after-ended compact transitions;
- successor progresses from revision 0 to revisions 1/10/maximum and current floor dominates origin;
- successor ends after progress and still validates against origin transition;
- transition byte bound enforced;
- start-after-ended embeds exact predecessor end proof;
- standalone historical end pair compacts without breaking transition;
- contiguous transition array and switched evidence ID invariants.

## Proof pagination

- one maximum transition plus final evidence fits a page;
- maximum legal transition count splits into bounded pages;
- no proof page includes full current state;
- reorder, identical duplicate, missing page, retry, and expiry;
- unequal duplicate index, mixed sender, mixed manifest, bad previous digest, wrong final digest reject;
- local high-water advance invalidates assembly;
- current outcome progress during transfer requires a new proof;
- complete proof atomically adopts floor, then separate snapshot recovery installs state;
- accumulated bytes and assembly-count overflow fail safely.

## Reconciliation

- exact descriptor;
- stale descriptor with incoming winner;
- complete local winner response;
- floor-only local winner floor response;
- former loser later wins and replaces only the active transition slot;
- repeated logical reconciliation consumes one slot;
- same-session story mutation rejects.

## Migration transcript

- two/three retained migration records;
- all advertisements for one record share one round ID;
- advertisement IDs fixture;
- canonical sorted transcript and deterministic winner;
- duplicate sender, wrong summary, wrong winner, wrong winning state, wrong transcript ID reject;
- receiver derives identical controller-changed state locally;
- two partitions with different valid transcripts later converge by comparator;
- departed controller rejoin does not revoke record;
- one max state plus max transcript remains below envelope limit.

## Termination and supersession

- dropped ACK/reload/resend;
- ended disposition requires certificate;
- end after progress preserves floor;
- A→B→C paginated stale-A recovery;
- A→B→B-ended paginated recovery;
- exact old disposition/certificate compacted plus missed lifecycle callback still converges;
- current evidence active/ended rules;
- below-high-water request never silently drops.

## Safety-lock matrix

- `evidence-limit`, `lineage-limit`, and fitting `operational-bytes` accept strictly higher proof;
- same/lower epoch rejects;
- failed compaction/fit leaves lock unchanged;
- `transition-limit` rejects safety request/gossip and exposes reset-only UI;
- `digest-collision` rejects network recovery;
- lock-unavailable clears only after reprobe/bootstrap;
- storage-failure clears only after local repair/bootstrap;
- chat/media/files remain usable.

## Cross-tab and checkpoints

- coherent metadata/pointer/record read retries on generation change;
- transaction holds lock through canonical-store install;
- crash after write before notification repaired on focus/action;
- generation-10 immutable record writes after generation-11 pointer publication;
- generation-11 record and pointer remain byte-identical;
- stale record is unreferenced and later garbage-collected;
- pointer to wrong key/generation/floor rejects;
- existing-key unequal bytes triggers storage failure.

## Property/fuzz

- comparator totality/transitivity;
- current outcome always dominates final canonical transition origin;
- same-epoch different-session winner replaces only active slot, and the slot seals after higher epoch/end;
- transition concatenation and noncircular proof page/final manifest hash chain;
- arbitrary page delivery never partially changes metadata;
- arbitrary message delivery converges while active;
- no same-epoch install after end;
- every exposed state equals current floor digest;
- disposition merge associative/commutative/idempotent;
- metadata interleavings preserve invariants or retain a valid lock.

## CI

Implementation PRs must run unit, type, lint, build, focused E2E, browser JCS/ID fixtures, and maximum-byte transport tests. Documentation-only commits may have no workflow run.
