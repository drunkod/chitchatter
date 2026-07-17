# 17 — Regression, validation, and rollout

> **Revision 12 changes:** rollout gates now require RFC 8785 conformance, retained epoch-transition provenance, real safety-lock recovery, lineage-bound advertisements, supersession after history trimming, and checkpoint generation fencing.

## Existing-feature regression

- chat, voice, video, screen share, file transfer, and DM navigation remain functional;
- exactly one group-room provider and none in DMs;
- `RoomVideoDisplay` keeps real props;
- novella cleanup never clears shared handlers;
- no room secret, invite URL, analytics, or cloud progress data is stored.

## Manual multi-window matrix

1. normal start/progression while inspecting RFC 8785 digest floor;
2. verify browser and Node bytes for string/number edge fixtures;
3. concurrent starts and partial coordinator crash;
4. reconciliation descriptor created at rev10 arrives after rev11, including floor-only receiver;
5. A→B→C, then deliver only A traffic and recover C;
6. A→B, end B, then recover stale A to ended current outcome;
7. trim A disposition, suppress lifecycle callback, then send A traffic and receive supersession chain;
8. retain two migration records and interleave advertisements/announcements;
9. rejoin departed controller before delayed earlier-lineage winner;
10. end with queued snapshot/reconcile responses and verify none install;
11. exhaust operational metadata and verify capacity lock persists in reserve;
12. recover capacity lock with strictly higher transition chain;
13. verify digest-collision lock refuses remote recovery;
14. disable Web Locks and verify only local reprobe can recover;
15. change metadata between bootstrap reads and verify retry;
16. run generation-10 checkpoint side effect after generation 11 and verify pointer stays at 11;
17. crash sibling after metadata write before notification, then focus stale tab;
18. rapid room navigation removes old receiver/store/audio.

## Milestone gates

1. **M1:** RFC 8785 canonicalizer, models, validators, engine, example story. Gate: cross-runtime canonical fixtures.
2. **M2:** coherent bootstrap, transition chain, starts, progression, floor/supersession recovery. Gate: multi-hop and trimmed-history stale-peer tests.
3. **M3:** rebasing reconciliation, lineage-bound migration, end evidence, safety recovery, locked persistence. Gate: all Revision 12 regressions.
4. **M4:** production rollback/end/supersession/safety UI, accessibility, assets/audio.
5. **M5:** adversarial E2E/fuzz, README, visible CI, optional signed transition/evidence chain.

## Command gate

```bash
npm test -- --run
npm run check:types
npm run lint
npm run build
npm run test:e2e -- e2e/tests/visual-novel.test.ts
```

## Final checklist

- canonical bytes follow RFC 8785 exactly with cross-runtime fixtures;
- state and floor use one SHA-256 ordering;
- every epoch has one retained transition certificate;
- A→B→C and ended-successor recovery work after reload;
- switched evidence remains valid after later switch/end;
- capacity recovery has a dedicated pre-gate path and lock-kind matrix;
- advertisements identify exact migration records;
- controller rejoin does not revoke retained migration evidence;
- every below-high-water peer receives current supersession evidence;
- normal metadata preserves durable lock reserve;
- checkpoint latest pointer is generation/floor fenced;
- floor-only conflict winner returns floor evidence and recovers full state;
- ended high water blocks all same-epoch installs;
- unavailable Web Locks have no unsafe fallback;
- rollback and safety states are visible and accurate;
- crash helpers cannot accidentally deliver dropped traffic.
