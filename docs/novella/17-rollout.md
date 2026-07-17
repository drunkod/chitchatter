# 17 — Regression, validation, and rollout gates

> **Revision 13 changes:** rollout now gates mutable outcome/transition semantics, bounded proof pagination, self-contained end dependencies, reset-only transition capacity, verifiable election transcripts, exact IDs, and immutable checkpoints.

## Existing-feature regression

- chat, voice, video, screen share, file transfer, and DM navigation remain functional;
- exactly one group-room novella provider and none in DMs;
- `RoomVideoDisplay` keeps real props;
- novella cleanup never clears shared handlers;
- no room secret, invite URL, analytics, proof assembly, or cloud progress data is stored.

## Manual multi-window matrix

1. start and progress to revision 10; verify transition remains revision-0 origin while current floor advances;
2. end after progress; verify transition remains unchanged and current outcome closes;
3. compare browser/Node JCS bytes and all protocol-derived IDs;
4. create maximum-size transitions and recover through several reordered proof pages;
5. drop one page, retry, duplicate another, and complete without partial state change;
6. advance holder during proof transfer; stale proof discards and new proof succeeds;
7. A→B→C stale-A recovery followed by separate C snapshot;
8. A→B, end B after progress, then recover stale A to ended B;
9. compact standalone B predecessor end evidence after C starts; transition still validates;
10. exact/full/floor-only reconciliation;
11. collect several advertisements under one migration round and validate transcript winner;
12. run competing valid transcripts from two partitions and converge;
13. rejoin departed controller before delayed earlier-lineage state;
14. exhaust transition count and verify reset-only lock;
15. exhaust lineage/evidence and recover with a fitting higher proof;
16. exhaust operational bytes where compaction cannot fit and verify lock remains;
17. run generation-10 checkpoint write after generation-11 pointer and verify immutable 11 record;
18. disable Web Locks and verify no unsafe write;
19. rapid room navigation removes receiver, proof assemblies, store, and audio.

## Milestone gates

1. **M1:** RFC 8785 canonicalizer, exact ID derivation, compact models, validators, engine, example story. Gate: cross-runtime fixtures.
2. **M2:** coherent bootstrap, compact transitions, paginated supersession, starts, progression, floor/snapshot recovery. Gate: maximum-byte page and mutable-outcome tests.
3. **M3:** rebasing reconciliation, transcript migration, end evidence, cause-specific safety recovery, immutable checkpoints. Gate: all Revision 13 regressions.
4. **M4:** production rollback/end/proof/safety UI, accessibility, assets/audio.
5. **M5:** adversarial E2E/fuzz, README, visible CI, optional signed evidence.

## Command gate

```bash
npm test -- --run
npm run check:types
npm run lint
npm run build
npm run test:e2e -- e2e/tests/visual-novel.test.ts
```

## Final checklist

- current outcome matches final canonical transition by subject and floor dominance, not equality;
- same-epoch different-session reconciliation may replace only the active high-water transition slot;
- compact transitions contain no full successor state;
- start-after-ended embeds its terminal predecessor proof;
- supersession/safety evidence is paginated and bounded;
- proof pages never partially mutate canonical metadata/state;
- active proof adoption is followed by separate exact snapshot recovery;
- all safety-critical IDs use one exact JCS/SHA-256 derivation;
- migration advertisements share one stable round and controller change carries a deterministic transcript;
- transition-limit is reset-only;
- other capacity recovery is fit-preflighted;
- checkpoint blobs are immutable generation-specific records;
- ended high water blocks all same-epoch installs;
- unavailable Web Locks have no unsafe fallback;
- rollback, proof, and safety UI accurately describe state.
