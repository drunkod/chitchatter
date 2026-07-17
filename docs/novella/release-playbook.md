# Novella release and rollback playbook

Use this playbook to decide whether a Novella build is ready for a preview or limited release and to reverse the release safely when a blocking problem appears.

Novella is a build-time, feature-flagged, ephemeral MVP. Releasing it does not require a data migration, and rolling it back does not require state cleanup.

## Release objective

Ship a build in which:

- the repository gate is green;
- the Novella feature is enabled only in the intended environment;
- two real browsers can complete the core synchronized flow;
- chat, direct messages, and media still work;
- the release can be disabled by deploying a build without the feature flag.

## Release inputs

Record these before starting:

```text
Commit SHA:
Branch or pull request:
CI run:
Preview URL:
Release owner:
Testers:
Target environment:
VITE_ENABLE_NOVELLA: true / false
```

Do not test an unidentifiable local tree. Every result must refer to a commit or immutable preview build.

## 1. Verify the code gate

The required repository commands are:

```bash
npm run check:types
npm test -- --run
npm run lint
git diff --exit-code
npm run build
npm run test:e2e
```

Release requirements:

- every command exits successfully;
- lint leaves the working tree unchanged;
- the build was produced from the recorded commit;
- Playwright artifacts are retained when a browser test fails;
- no required check is skipped because another check happened to pass.

A green unit suite is not a substitute for the two-browser test because peer discovery and WebRTC behavior depend on the browser environment.

## 2. Build with the intended feature state

Novella is controlled by `VITE_ENABLE_NOVELLA` at build time.

Enabled preview or release:

```bash
VITE_ENABLE_NOVELLA=true npm run build
```

Disabled control build:

```bash
VITE_ENABLE_NOVELLA=false npm run build
```

Confirm the hosting environment supplies the intended value during the build. Changing the variable after deployment does not change an already-built Vite bundle.

## 3. Verify the disabled control build

Before approving the enabled build, verify the rollback shape:

1. Open a public group room in the disabled build.
2. Confirm no **Novella** region appears.
3. Confirm chat, peer list, direct messages, camera, microphone, screen sharing, and file controls still work.
4. Confirm the browser console has no failed Novella dynamic import or missing-story error.

Expected result: the host application behaves as it did before Novella was enabled.

## 4. Run the enabled-build smoke test

Use two isolated browser identities and the same public room URL.

Minimum smoke path:

1. Confirm ordinary chat propagates in both directions.
2. Confirm **Harbour Lights** appears in both group-room views.
3. Start the story in Browser A.
4. Advance from Browser B.
5. Select one branch from Browser B.
6. Confirm both browsers show the same dialogue and revision.
7. Refresh Browser B and confirm snapshot recovery.
8. Close Browser A and confirm Browser B can claim control.
9. Continue one dialogue after the claim.
10. Open a direct-message conversation and confirm it contains no Novella runtime.

Run the full human flow in [`demo-playbook.md`](./demo-playbook.md) for a release candidate or first deployment to a new environment.

## 5. Compatibility sample

At minimum, include:

- one Chromium-family browser;
- one second isolated identity;
- one mobile-width viewport;
- one camera or microphone permission check;
- one network different from the release owner's network for a public preview.

Use [`compatibility-accessibility-playbook.md`](./compatibility-accessibility-playbook.md) for the complete matrix.

## 6. Go/no-go decision

### Go

Release only when all are true:

- [ ] CI is green for the exact commit.
- [ ] Enabled and disabled builds were distinguished correctly.
- [ ] The two-browser smoke path passed.
- [ ] Late join or refresh recovery passed.
- [ ] Controller departure and claim passed.
- [ ] Chat and direct-message regressions passed.
- [ ] No new uncaught console error appeared.
- [ ] A rollback build or previous known-good deployment is available.

### No-go

Do not release when any of these occurs:

- peers display different dialogue or revision after waiting for recovery;
- a participant can start a competing story while an active session exists;
- controller departure leaves all remaining peers permanently blocked;
- direct-message rooms mount a Novella runtime;
- enabling Novella breaks chat or media controls;
- the feature cannot be removed by deploying the disabled build;
- the failure cannot be reproduced because the tested build is unidentified.

Cosmetic issues may be accepted only when they do not hide controls, block reading, or violate keyboard and screen-reader basics.

## 7. Limited rollout

For the first live test:

1. Keep the feature behind `VITE_ENABLE_NOVELLA=true` only in the selected preview environment.
2. Invite a small number of cooperative testers.
3. Ask testers to use separate devices or networks where possible.
4. Run one complete branch and one controller handoff.
5. Record only observed failures; do not expand the protocol based on hypothetical durability cases.
6. Keep the disabled build ready until the session completes.

The MVP has no persistent story data. Users should be reminded that refreshing rejoins through peers and that the story disappears when the room empties.

## 8. Rollback

Rollback triggers include:

- repeatable state divergence;
- inability to continue after controller departure;
- a regression in ordinary room communication;
- a security or trust-boundary validation failure;
- browser crashes or an unusable room layout.

Rollback procedure:

1. Stop inviting new testers.
2. Record the failing commit, URL, browsers, peer count, and reproduction steps.
3. Preserve screenshots, console output, and Playwright artifacts.
4. Deploy the previous known-good build or rebuild with `VITE_ENABLE_NOVELLA=false`.
5. Open a fresh group room and verify chat and media in the rollback build.
6. Mark the release as rolled back and link the incident record.

Do not attempt to preserve or migrate the active story. Story state is intentionally ephemeral and disappears with the room session.

## 9. Release record

```text
Release decision: GO / NO-GO / ROLLED BACK
Commit SHA:
CI run:
Build environment:
Preview or release URL:
Feature flag value:
Browsers and devices:
Networks represented:
Demo playbook result:
Compatibility result:
Known accepted issues:
Rollback build or deployment:
Decision owner:
Date and time:
Notes:
```
