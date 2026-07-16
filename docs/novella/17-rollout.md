# 17 — Regression, validation, and rollout

> **Revision 7 changes:** adds gates for metadata-before-receiver bootstrap, same-epoch decision recovery, election supersession after first apply, termination re-ack, and user-visible reconciliation rollback.

## Existing-feature regression

- text chat before, during, and after story transitions;
- microphone, video, screen share, file transfer, and DM navigation;
- `RoomVideoDisplay userId width height` remains mounted correctly;
- group room owns exactly one novella provider; keep-mounted DMs own none;
- keyed novella handler cleanup never flushes chat/media handlers;
- public and password-protected rooms store no raw invite URL or secret.

## Manual multi-window matrix

1. Join the same room in isolated browser profiles and verify chat/media.
2. Start one story and progress normally.
3. Start concurrently; verify one normal decision when connected.
4. Partition the profiles in the failure harness, progress different timelines, heal, and verify the deterministic winner plus visible rollback notice.
5. Crash a coordinator after delivering a start commit to one peer; verify holder gossip and convergence.
6. Disconnect the controller with peers holding divergent membership views; verify a later migration announcement can supersede the first and all peers converge.
7. Drop the first termination ACK; verify duplicate end re-acks and finalization.
8. Reload every browser after epoch/tombstone creation; verify metadata restores before any network event is processed.
9. Corrupt RoomMeta; verify blocking recovery UI rather than an empty-safety receiver.
10. Leave and rejoin as a participant; verify no stale React closure drops the synchronous recovery snapshot.

## Rollout sequence

1. **M1:** models, validators, engine, example story. Gate: validator and engine matrices.
2. **M2:** bootstrap runtime, start proposal/decision/gossip, progression, exact-target snapshots. Gate: partial-commit and sender-identity tests.
3. **M3:** start reconciliation, migration record/supersession, termination ACKs, RoomMeta, participation. Gate: partition and reload matrices.
4. **M4:** production UI including `reconciling`, rollback explanation, provisional discard, termination state, accessibility, audio.
5. **M5:** E2E, fuzz/negative tests, README, visible CI, optional signatures.

## Command gate

```bash
npm test -- --run
npm run check:types
npm run lint
npm run build
npm run test:e2e -- e2e/tests/visual-novel.test.ts
```

All commands must run in CI for implementation changes.

## Final review checklist

- no secrets, raw room URLs, trackers, analytics, or executable story content;
- no unbounded envelopes or storage records;
- no second room/microphone/provider;
- all action types have normalization, gate behavior, authorization, dispatch, and tests;
- all critical metadata writes are awaited;
- all reconciliation behavior is described as deterministic rollback, not strict consensus;
- no unrelated formatting changes.
