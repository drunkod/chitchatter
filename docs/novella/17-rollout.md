# 17 — Regression, validation, and rollout

> **Revision 10 changes:** rollout gates now require universal epoch closure, nonterminal reconciliation evidence, migration lineage, symmetric conflicts, comparator floors, and lock-scoped state installation.

## Existing-feature regression

- text chat, voice, video, screen share, file transfer, and DM navigation remain functional;
- exactly one group-room provider and none in DM rooms;
- `RoomVideoDisplay` retains real props;
- novella cleanup never clears shared handlers;
- no room secret/invite URL, analytics, or cloud progress data is stored.

## Manual multi-window matrix

1. normal start and progression while verifying floor updates;
2. concurrent starts and partial coordinator crash;
3. rev10 checkpoint/floor versus delayed rev1 decision;
4. session B loses, progresses farther while partitioned, then wins on heal;
5. end canonical session while snapshot/reconcile responses are queued; none reinstall;
6. two sequential controller departures; deliver earlier-departure stronger announcement last;
7. derive one conflict from opposite peers and compare IDs;
8. active outcome with all checkpoints deleted; exact-recover using floor;
9. current-epoch disposition/lineage bound exhaustion remains read-only without trimming;
10. same session/epoch attempts different story version and is rejected;
11. lose end ACK, reload recipient, verify re-ACK;
12. stale retired checkpoint cannot be deleted, reload still reaches lobby/recovery;
13. two same-room tabs race outcome replacement/end and never show stale post-write install;
14. rapid room navigation removes old receiver/store.

## Milestone gates

1. **M1:** models, validators, engine, example story.
2. **M2:** bootstrap, floor, starts, progression, exact recovery. Gate: floor-only and universal closed-epoch tests.
3. **M3:** reconciliation, migration lineage, ACK/certificates/dispositions, lock-scoped transactions. Gate: all Revision 10 regressions.
4. **M4:** production rollback/end/disposition UI, accessibility, assets/audio.
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

- every action has model, normalization, semantic boundary, gate, authorization, dispatch, persistence order, and tests;
- reconciled active-epoch timelines remain eligible as complete-state evidence;
- ended high-water epoch blocks every state-installing path and cancels recovery;
- high water dominates all durable records;
- canonical floor advances with every exposed state;
- metadata and canonical-store install share one room lock;
- migration lineage preserves sequential-departure authority;
- conflict descriptors are symmetric and first-contact verifiable;
- current-epoch safety records never trim;
- same-session story identity is immutable;
- stale authoritative checkpoints are discarded, not blocking;
- retirement gossip carries exact structured evidence;
- no timer is an authorization deadline;
- rollback is visible and accurately described;
- crash helpers cannot accidentally deliver dropped traffic.
