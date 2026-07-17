# 17 — Regression, validation, and rollout

> **Revision 8 changes:** rollout gates now require identity-safe end certificates, non-expiring durable migration authority, boot-baseline receiver ordering, bytewise comparison, serialized metadata, and realistic crash queues.

## Existing-feature regression

- text chat, voice, video, screen share, file transfer, and DM navigation before/during/after novella actions;
- exactly one group-room provider and no DM provider;
- `RoomVideoDisplay` keeps real props;
- keyed novella cleanup never flushes shared handlers;
- no raw room secret/invite URL or analytics storage.

## Manual multi-window matrix

1. normal start and branch progression;
2. concurrent start and partial commit/coordinator crash;
3. partition, progress same session to equal revision with different branches, heal and observe rollback;
4. controller migration with divergent views; delay the winning announcement well beyond retry cadence and reload one peer before delivery;
5. begin termination, drop ACK, crash controller, migrate/progress stale population, then deliver holder certificate and observe rollback-to-lobby;
6. reload every peer with active start/migration/tombstones and verify no message processes before metadata/checkpoint bootstrap;
7. force metadata write/lock failure and verify state remains unchanged/read-only;
8. navigate rapidly between rooms and verify no old-room receiver or provisional state survives;
9. leave/rejoin participation with synchronous exact-target snapshot.

## Milestone gates

1. **M1:** validator/engine/property matrices.
2. **M2:** complete bootstrap, start/gossip, progression, exact recovery. Gate: partial commit, baseline race, target-bound recovery.
3. **M3:** full-state reconciliation, durable migration, ACK/end certificate, serialized RoomMeta. Gate: partition, delayed migration, termination crash, write races.
4. **M4:** production rollback/end/provisional UI, accessibility, audio.
5. **M5:** E2E, fuzz/negative tests, README, visible CI, optional signatures.

## Command gate

```bash
npm test -- --run
npm run check:types
npm run lint
npm run build
npm run test:e2e -- e2e/tests/visual-novel.test.ts
```

## Final checklist

- every action has model, structural normalization, semantic boundary, gate behavior, authorization, dispatch, persistence ordering, and tests;
- no timer is an authorization deadline under unbounded delay;
- no retained original envelope is forwarded directly by another peer;
- all distributed ordering is canonical byte ordering, never locale collation;
- all RoomMeta writes are serialized from latest validated state;
- metadata plus checkpoint baseline load before receiver;
- rollback behavior is visible and accurately described;
- test crash helpers cannot accidentally deliver dropped coordinator traffic;
- no unrelated feature regression.
