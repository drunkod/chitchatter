# 03 — Runtime structural validation and normalization

> **Revision 13 changes:** validates compact origin certificates, mutable-outcome dominance, paginated proof chains, exact derived IDs, election transcripts, cause-specific locks, and immutable checkpoint keys.

## Envelope pipeline

1. reject encoded input above `maxEnvelopeBytes` before deep traversal;
2. validate protocol/action/primitive fields;
3. normalize the selected payload into fresh bounded objects;
4. cross-check outer subject and transport sender identity;
5. drop unknown fields and MVP `proof`;
6. run semantic story/state validation;
7. compute JCS bytes, state digest, and every required protocol-derived ID;
8. authorize only after all identities and byte budgets are known.

## Exact derived IDs

For every transition, conflict, migration record, migration round, advertisement, transcript, decision, proof manifest, and proof page:

- reconstruct the exact domain input object;
- omit the ID being derived;
- serialize with RFC 8785;
- apply `deriveProtocolId`;
- reject non-lowercase-hex or mismatched values.

No locale, insertion-order, FNV, UUID ordering, or host-dependent serializer participates in safety identity.

## Compact transition certificates

Validate:

- initial start: null predecessor, successor epoch 1, start-decision origin;
- later transition: predecessor epoch exactly successor epoch minus one;
- switch: predecessor outcome active, no embedded end certificate, session-started origin;
- start-after-ended: predecessor outcome ended and exact embedded completed-end certificate;
- successor subject equals origin floor subject and revision is 0;
- origin certificate IDs and state-floor digest fields recompute;
- transition ID recomputes from every normalized field;
- encoded transition certificate stays within its dedicated byte bound.

The metadata transition array is contiguous from epoch 1 through high water. Slots below high water are sealed. A transaction may replace only the active high-water slot when a same-epoch different-session reconciliation state wins and carries a valid competing origin transition with the same sealed predecessor.

## Current outcome dominance

Let `last` be the final retained transition:

- `epochOutcome.epoch`, canonical session, story, and version equal `last.successorSubject`;
- `compareFloor(epochOutcome.floor, last.successorOriginFloor) >= 0`;
- active outcome has `activeOrigin` pointing to the last transition;
- ended outcome has null active origin and an exact current completed-end certificate;
- progression/end never changes the stored winning transition certificate.

## Proof manifests and pages

Validate every page independently:

- purpose matches action type;
- request action ID and requested subject match the outstanding recovery;
- page count/index and epoch range are bounded;
- source peer equals the recovery target and every page carries the same bounded positive `sourceGeneration`;
- page payload and accumulated assembly bytes fit limits;
- transitions are nonempty except an explicitly allowed final evidence-only page;
- transition sequence within a page is contiguous;
- page 0 has null previous digest; later pages name the prior page digest;
- page digest recomputes from `manifestCore` that excludes `proofId` and `finalPageDigest`; proof ID recomputes from that core plus final page digest;
- current evidence appears only on the final page and hashes to `currentEvidenceDigest`.

After all pages arrive:

- order by page index;
- verify page-digest chain ends at manifest `finalPageDigest`;
- concatenate transitions and require exact epoch continuity from `fromEpochExclusive + 1` through `toEpochInclusive`;
- verify final transition subject matches current outcome identity;
- require current floor to dominate final transition origin floor;
- validate active origin or ended certificate;
- reject mixed senders, mixed manifests, duplicate index with unequal bytes, stale proof IDs, or over-budget assemblies.

No page mutates RoomMeta or canonical state before complete-proof validation.

## Dispositions and end evidence

- ended disposition enters metadata only with exact completed-end certificate;
- current ended certificate never trims;
- historical standalone certificates may trim even when their content is embedded in a retained start-after-ended transition;
- switched disposition references the canonical immediate successor transition;
- while that successor epoch is active, replacement of its canonical transition also replaces the predecessor switched evidence ID; once the successor slot is historical or ended, a conflicting switched ID blocks;
- reconciled records merge by deterministic logical key;
- conflicting ended/switched evidence IDs block.

## Migration records and elections

For a migration record:

- `migrationId` derives from epoch/session/departed controller/opening revision;
- `migrationRoundId` derives only from `migrationId` and the same immutable record fields;
- current peer presence is checked only when opening the record.

For advertisements:

- round ID selects one retained record;
- candidate equals sender;
- advertised state matches active session/story/epoch;
- advertisement ID derives from round, sender/candidate, and state priority.

For controller change:

- transcript advertisements are sorted and unique by sender;
- every summary ID recomputes;
- transcript round matches the selected record;
- winner is deterministic under the documented ordering;
- full `winningState` exactly matches the winner summary priority/digest;
- derived controller-change state is produced locally by the pure engine;
- transcript ID recomputes.

## Safety locks

- `transition-limit` and `digest-collision` never accept network recovery;
- other capacity codes accept only `SAFETY_RECOVERY_GOSSIP`;
- complete proof must end strictly above `lockedAtEpoch`;
- recovery preflight compacts only permitted historical arrays and proves final metadata fits operational limits;
- clearing lock and adopting higher outcome happen in one room-lock transaction;
- same/lower epoch or a proof requiring transition count beyond the limit rejects.

## Checkpoint records

The storage key is derived locally as:

```text
visual-novel:v1:<roomScope>:checkpoint:<sessionId>:<generation>:<floorDigest>
```

Validate pointer and record key, session, generation, floor digest, and state digest. A key collision with unequal bytes is a storage failure. Pointer publication may reference only the exact immutable record named by its generation token.

## Required tests

- official/reference JCS fixtures and exact derived-ID fixtures across browser and Node;
- progressed and ended current outcomes dominate immutable origin transition;
- maximum-size proof page and maximum-size snapshot remain below envelope budget;
- reordered/duplicated/lost proof pages and mixed-sender rejection;
- start-after-ended transition survives standalone end-certificate compaction;
- transition-limit lock rejects safety-recovery request/gossip;
- shared migration round plus transcript winner;
- stale checkpoint writer cannot overwrite immutable newer blob;
- alias-free normalization for all 26 actions and durable/runtime records.
