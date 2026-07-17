# 17 — Regression, validation, and rollout

> **Revision 11 changes:** rollout gates now require one digest ordering, coherent successor notices, conflict rebasing, generation-stable bootstrap, deterministic disposition merge, explicit safety-lock behavior, and Web Lock capability handling.

## Existing-feature regression

- text chat, voice, video, screen share, file transfer, and DM navigation remain functional;
- exactly one group-room provider and none in DM rooms;
- `RoomVideoDisplay` keeps real props;
- novella cleanup never clears shared handlers;
- no room secret/invite URL, analytics, or cloud progress data is stored.

## Manual multi-window matrix

1. normal start/progression while inspecting persisted SHA-256 floor;
2. construct equal-priority states whose raw canonical-byte order differs from unrelated hash order and confirm digest ordering is universal;
3. concurrent start and partial coordinator crash;
4. session B loses, progresses farther, then heals and wins;
5. create reconcile descriptor, progress receiver once, then deliver and observe rebase;
6. repeat the rebase scenario for migration;
7. switch story, deliver only retirement gossip first, and recover successor coherently;
8. inject ended disposition without certificate and verify no suppression;
9. end while snapshot/reconcile responses are queued; none reinstall;
10. two sequential controller departures; deliver earlier stronger announcement last;
11. change metadata between bootstrap meta/checkpoint reads and verify retry;
12. repeat reconciliation many times and verify one logical disposition record;
13. exhaust a current-epoch safety bound and verify room-wide novella read-only state;
14. disable/deny Web Locks and verify no unsafe write/install;
15. crash a sibling after metadata write before notification, then focus stale tab and verify refresh;
16. stale checkpoint deletion failure still reaches recovery/lobby;
17. rapid room navigation removes old receiver/store/audio.

## Milestone gates

1. **M1:** models, validators, digest/canonicalizer, engine, example story.
2. **M2:** stable bootstrap, floor, origins, starts, progression, exact recovery. Gate: digest-order equivalence and mixed-generation retry.
3. **M3:** rebasing reconciliation, migration lineage, ACK/certificates/dispositions, successor evidence, lock-scoped transactions. Gate: all Revision 11 regressions.
4. **M4:** production rollback/end/safety-capacity/capability UI, accessibility, assets/audio.
5. **M5:** E2E, fuzz/negative tests, README, visible CI, optional signed evidence chain.

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
- canonical bytes and SHA-256 function are exact and domain-separated;
- full-state and floor ordering are identical;
- active origin covers both coordinated start and switch;
- switched disposition never persists without successor evidence;
- ended disposition is terminal only with certificate;
- stale conflict descriptors rebase;
- bootstrap metadata/checkpoint are one stable generation;
- logical dispositions upsert deterministically;
- current-epoch overflow enters room-wide safety lock;
- unavailable Web Locks have no unsafe fallback;
- focus/action refresh repairs lost generation notification;
- ended high-water epoch blocks every state-install path;
- migration lineage preserves sequential departures;
- current-epoch safety evidence never trims;
- same-session story identity is immutable;
- stale authoritative checkpoints are nonblocking;
- rollback and safety states are visible and accurate;
- crash helpers cannot accidentally deliver dropped traffic.
