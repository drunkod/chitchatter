# 17 — Regression, validation, and rollout

> **Revision 9 changes:** milestone gates now require durable epoch closure, separate retirement/certificates, strongest baselines, reload-safe ACKs, session-bound migration, and true in-lock metadata mutation.

## Existing-feature regression

- text chat, voice, video, screen share, file transfer, and DM navigation remain functional;
- exactly one group-room provider and none in DM rooms;
- `RoomVideoDisplay` retains real props;
- novella cleanup never clears shared handlers;
- no room secret/invite URL, analytics, or cloud progress data is stored.

## Manual multi-window matrix

1. normal start and branch progression;
2. concurrent start and partial coordinator crash;
3. reload with rev10 checkpoint and rev0 active decision, then deliver competing rev1;
4. partition same session to equal-revision different branches, heal and observe rollback;
5. migrate, progress to rev20, then deliver delayed rev12 controller announcement;
6. attempt cross-session controller announcement, reconcile start session first, then reopen migration if needed;
7. begin end, lose ACK, reload recipient, verify original resend re-ACKs;
8. end canonical winner, then deliver losing same-epoch decision and verify lobby remains closed;
9. switch story and verify old session is retired without completed-end gossip;
10. run two same-room tabs with overlapping metadata writes;
11. rapidly navigate rooms and verify old receiver/provisional state disappears.

## Milestone gates

1. **M1:** models, validators, engine, example story.
2. **M2:** complete bootstrap, starts, progression, exact recovery. Gate: strongest-baseline and partial-commit tests.
3. **M3:** reconciliation, session-bound migration, ACK/certificates, retirement/outcome, locked RoomMeta. Gate: all Revision 9 regressions.
4. **M4:** production rollback/end/retirement UI, accessibility, assets/audio.
5. **M5:** E2E, fuzz/negative tests, README, visible CI, optional signed chain.

## Command gate

```bash
npm test -- --run
npm run check:types
npm run lint
npm run build
npm run test:e2e -- e2e/tests/visual-novel.test.ts
```

## Final checklist

- every action has model, normalization, semantic boundary, gate, authorization, dispatch, persistence order, and tests;
- full-state handlers compare against the strongest progressed baseline;
- ended high-water epoch cannot reopen;
- original end binds epoch/story and re-ACK survives reload;
- retirement is not conflated with completed-end evidence;
- migration is session-bound; cross-session conflict resolves first;
- metadata mutation callback runs inside storage lock against latest data;
- no timer is an authorization deadline;
- all ordering is canonical byte ordering;
- rollback is visible and accurately described;
- crash helpers cannot accidentally deliver dropped traffic.
