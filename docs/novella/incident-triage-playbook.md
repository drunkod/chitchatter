# Novella incident triage playbook

Use this playbook when a tester reports a stuck lobby, divergent story state, failed handoff, or regression in the host room.

The first triage goal is classification, not protocol redesign. Determine whether the failure belongs to peer connectivity, Novella synchronization, story content, or room UI.

## 1. Stabilize the evidence

Before anyone refreshes or clicks again:

1. Ask every peer to stop interacting.
2. Capture the full Novella panel on every browser.
3. Record visible dialogue, revision, storyteller label, warnings, and enabled controls.
4. Record whether each peer still appears in the peer list.
5. Send one ordinary chat message between affected peers.
6. Save console errors and warnings.
7. Record browser, operating system, network, commit, and environment URL.

Do not publish private room URLs, chat content, user files, ICE credentials, or tokens.

## 2. Assign initial severity

### P0 — disable or roll back immediately

- enabling Novella breaks ordinary room access for most users;
- a security boundary is bypassed, such as accepting a forged sender identity or unsafe story asset;
- the page crashes repeatedly or enters an uncontrolled send loop.

### P1 — blocks the MVP flow

- connected peers remain on different canonical dialogue or revision;
- a progressed active session is replaced by a competing fresh session;
- no remaining peer can continue after the storyteller leaves;
- a late joiner can never recover while ordinary chat works;
- Novella mounts in a direct-message room.

### P2 — recoverable but materially disruptive

- one request times out and requires retry;
- recovery succeeds only after refresh;
- controls remain disabled after an error;
- rapid room navigation creates a temporary stale view;
- media or chat causes the story panel to reset but peers can recover.

### P3 — cosmetic or documentation

- layout clipping with a workaround;
- misleading wording that does not change protocol behavior;
- minor focus order, spacing, or status-message defects.

## 3. Run the classification decision tree

### Does ordinary chat work between the same peers?

**No:** investigate room connectivity first.

Check:

- tracker or pairing-server availability;
- whether peers appear in each other's peer list;
- WebRTC permission and ICE failures;
- VPN, firewall, privacy-extension, or enterprise-policy interference;
- whether the existing non-Novella two-peer room test also fails.

Do not label this a Novella state-recovery defect until the baseline room works.

**Yes:** continue with Novella triage.

### Do all peers show the same session ID and revision?

- Same session, different revisions: likely dropped canonical event or failed snapshot recovery.
- Different sessions: likely competing start or snapshot arbitration failure.
- Same revision, different dialogue or variables: deterministic replay or state-validation failure.
- No state on one peer: bootstrap, targeted response, or timeout handling failure.

### Is the recorded storyteller still connected?

- Connected: participant requests and snapshots should target that peer.
- Disconnected: replicas should be paused and only the lowest eligible peer should claim.
- Rejoined before a claim: verify whether the session resumes or the refreshed peer recovers from the current controller.

## 4. Choose a safe user mitigation

Use the smallest mitigation that restores cooperative use:

1. Retry the action after a nonfatal timeout warning.
2. Wait for snapshot recovery when the UI says it is syncing.
3. Refresh only the affected participant while at least one healthy session peer remains.
4. Use **Continue the story** after the storyteller has actually left.
5. Start a fresh story only after the room agrees there is no active session.
6. Disable the feature build when ordinary room behavior is regressed.

Never promise recovery after every peer leaves. The MVP deliberately has no persistent checkpoint.

## 5. Capture the minimum useful evidence

Required:

```text
Summary:
Severity:
Commit/build:
Environment:
Room type:
Date and time with timezone:
Browsers and operating systems:
Number of peers:
Displayed usernames or redacted peer labels:
Story/session state per peer:
Last successful shared action:
First divergent or stuck action:
Does ordinary chat work?:
Does media work?:
Controller present?:
Network throttling/offline state:
Console errors and warnings:
Screenshots before refresh:
Reproduction frequency:
```

Helpful when available:

- Playwright trace, video, and report;
- exact order of peer joins and leaves;
- whether the problem follows refresh, simultaneous join, or claim;
- whether the feature-disabled build is healthy;
- whether the same result occurs on another browser or network.

## 6. Reproduce with a reduced matrix

Start with the smallest scenario:

1. Two browsers, same network, no media.
2. Two browsers, participant action.
3. Add the reported refresh, delay, or departure.
4. Add a third peer only when the defect requires it.
5. Repeat on a second browser family or network only after the minimal case is known.

Avoid changing multiple variables at once. Record the first step where state diverges.

For timing and disconnect defects, follow [`failure-injection-playbook.md`](./failure-injection-playbook.md).

## 7. Map symptoms to likely code areas

| Symptom | First code area to inspect |
| --- | --- |
| Invalid or forged envelopes accepted | `VisualNovelProtocol.ts` and transport sender binding |
| Different revisions after an action | `VisualNovelSession.ts` canonical event handling |
| Same revision but different state | `VisualNovelEngine.ts` timestamp/replay determinism |
| Late join remains in lobby | snapshot request/response and recovery tracking |
| Wrong peer can claim | peer-presence view and `CONTROL_CLAIMED` authorization |
| Story data rejected | validators and bundled story catalog |
| Novella appears in a DM | group-room mount and action namespace |
| Old room flashes after navigation | `useThrottledRoomMount.ts` timer ownership |
| Video disappears | `RoomVideoDisplay` and room layout integration |

This table is a starting point, not proof of root cause.

## 8. Add the right regression test

Prefer the lowest test layer that reproduces the failure:

- engine test for deterministic story transition errors;
- validator test for malformed story or session state;
- protocol test for envelope shape and identity rules;
- `TestVisualNovelTransport` session test for ordering, loss, duplication, join, or departure;
- React test for controls, phases, and mount boundaries;
- Playwright test for real browser integration and host-room regressions.

A bug is not closed until the regression test fails before the fix and passes after it.

## 9. Verify the fix

Run:

```bash
npm run check:types
npm test -- --run
npm run lint
git diff --exit-code
npm run build
npm run test:e2e
```

Then repeat the original real-browser reproduction with the same peer count, browsers, and network conditions.

For a release blocker, also verify the feature-disabled build remains healthy.

## 10. Closure criteria

Close the incident only when:

- the root cause and affected scope are written down;
- a regression test covers the failure where practical;
- the exact commit passes CI;
- the reporter's browser scenario has been repeated successfully;
- no out-of-scope durability guarantee was added merely to close an MVP defect;
- documentation is updated when the expected behavior was misunderstood.

## Issue template

```markdown
## Summary

## Severity and user impact

## Build and environment

## Peer setup

## Steps to reproduce

## Expected result

## Actual result

## State observed on each peer

## Chat/media baseline

## Console output and screenshots

## Reproduction frequency

## Suspected area

## Safe mitigation

## Regression test plan
```
