# Novella controlled failure-injection playbook

Use this playbook to exercise the MVP recovery rules in real browsers without adding persistence, election rounds, or other post-MVP machinery.

The goal is to confirm graceful user-visible behavior under ordinary disconnects, delays, refreshes, and competing actions. It is not a Byzantine or arbitrary-partition certification plan.

## Safety boundaries

Run failure injection only in a disposable public room with the bundled story.

- Do not use a private room URL in screenshots or issue text.
- Do not test with sensitive chat or files.
- Stop clicking as soon as peers visibly diverge.
- Capture evidence before refreshing.
- Restore normal network settings after every scenario.
- Close all test browsers when finished so the ephemeral session is discarded.

## Test setup

Use three isolated browser identities:

- Browser A — initial storyteller;
- Browser B — participant and first handoff candidate;
- Browser C — late joiner or competing participant.

Before every scenario:

1. Confirm all expected peers appear in the peer list.
2. Send chat in both directions.
3. Start **Harbour Lights** and record the visible revision on each peer.
4. Keep DevTools open on at least one participant.
5. Record the commit and environment.

If ordinary chat does not work, classify the result as a room-connectivity failure rather than a Novella failure.

## Scenario 1 — delayed late join

Purpose: verify that a joining peer remains in recovery until it receives a valid snapshot or the request times out.

1. Progress the story to revision 2 or later in Browser A.
2. Set Browser C to **Slow 3G** before joining.
3. Join the same room in Browser C.
4. Observe the lobby and recovery message without clicking **Start story**.
5. Return Browser C to normal network speed.

Expected result:

- Browser C does not create a competing revision-0 session;
- Browser C eventually installs the storyteller's current state;
- the recovered dialogue and revision match A and B;
- a temporary recovery warning clears after success.

Failure evidence:

- time from join to peer visibility;
- time from peer visibility to snapshot recovery;
- whether **Start story** became enabled prematurely;
- console messages from all peers.

## Scenario 2 — simultaneous bootstrap

Purpose: exercise multiple joining peers that initially have no local state.

1. Keep a progressed session active in Browser A.
2. Open Browsers B and C at approximately the same time.
3. Use **Slow 3G** on one joiner and normal speed on the other.
4. Wait without starting a story on either joiner.

Expected result:

- an empty joiner's negative response does not cancel the other joiner's recovery;
- both joiners accept the progressed storyteller snapshot;
- neither joiner remains permanently in the lobby;
- all three peers converge on the same session and revision.

Repeat with the slow and normal peers reversed.

## Scenario 3 — participant request during delay

Purpose: verify that a participant command remains single-flight and times out without corrupting local state.

1. Start a synchronized session with A as storyteller and B as participant.
2. Throttle or temporarily disconnect Browser A.
3. Click **Continue** once in Browser B.
4. Do not click repeatedly while the request is pending.
5. Wait for the request timeout or restore Browser A.

Expected result:

- controls are disabled while the command is pending;
- B does not advance optimistically;
- timeout produces a warning and re-enables controls;
- restoring the storyteller allows a later command or snapshot recovery.

## Scenario 4 — storyteller departure

Purpose: verify pause and explicit click-to-claim handoff.

1. Progress the story with A as storyteller.
2. Close Browser A completely.
3. Observe B and C without clicking immediately.

Expected result:

- both replicas pause at their current state;
- only the lowest eligible connected peer sees **Continue the story**;
- no peer advances while paused.

On the eligible peer:

1. Click **Continue the story** once.
2. Wait for the other peer to show the new storyteller.
3. Advance once.

Expected result: both remaining peers converge and continue at the next revision.

## Scenario 5 — near-simultaneous claims

Purpose: confirm deterministic claim acceptance in the cooperative race the MVP supports.

1. Arrange B and C as replicas of A's active story.
2. Close A.
3. Attempt to click **Continue the story** on both peers as closely together as the UI permits.

Expected result:

- only the eligible lowest peer should normally expose the button;
- when both claims are emitted during a stale UI race, replicas settle on the lower claimant;
- the losing peer remains a participant and can continue through the winner;
- a second click may be needed only after a stale claim is corrected by a newer snapshot.

Record peer IDs and the order in which controls appeared.

## Scenario 6 — storyteller refresh

Purpose: confirm that refresh behaves as a disconnect and new peer join rather than persistence.

1. Start a story with A as storyteller and keep B connected.
2. Refresh A.
3. Observe B during A's departure and rejoin.

Expected result:

- B pauses when the original storyteller peer disappears;
- if the same controller peer identity is restored before a claim, the session resumes;
- otherwise the eligible remaining peer can claim;
- the refreshed browser recovers from the current controller through a snapshot.

Do not expect local storage to restore the story without another peer.

## Scenario 7 — complete room loss

Purpose: verify the intentional ephemeral boundary.

1. Close every browser in the room.
2. Wait for peer connections to disappear.
3. Open the same room URL again.

Expected result: no previous story is recovered, and a fresh session may be started.

This is a pass, not a data-loss defect.

## Scenario 8 — rapid room navigation

Purpose: verify that stale timers cannot remount an old room.

1. Enter public room A.
2. Immediately navigate to room B.
3. Immediately return to A.
4. Repeat once more before the backoff reset period expires.

Expected result:

- each navigation attempt receives its own mount allowance;
- the old room does not flash into view because of a stale timer;
- the peer list does not show duplicate identities from the same browser;
- chat works after the final room mounts.

## Scenario 9 — media activity during recovery

Purpose: ensure the shared room remains usable while Novella is syncing.

1. Start camera or microphone on Browser A.
2. Join Browser C late while the story is progressed.
3. Send chat while C is recovering.
4. Toggle the media control once after C catches up.

Expected result:

- `RoomVideoDisplay` remains mounted;
- chat and media do not reset the story;
- Novella recovery does not block unrelated room controls;
- direct-message windows still contain no Novella runtime.

## Result template

```text
Scenario:
Commit/build:
Environment URL:
Date and time:
Browsers and versions:
Peer IDs or displayed usernames:
Network settings:
Starting session/revision:
Actions performed:
Expected result:
Actual result:
Final session/revision per peer:
Chat baseline: PASS / FAIL
Console errors:
Screenshots or video:
Reproducible: YES / NO / INTERMITTENT
Cleanup completed: YES / NO
```

## Exit criteria

The failure-injection pass is complete when:

- each scenario has an identified result;
- any divergence includes evidence captured before refresh;
- connectivity failures are separated from Novella failures;
- all browser throttling and offline settings are restored;
- all disposable room sessions are closed;
- repeatable defects are filed using [`incident-triage-playbook.md`](./incident-triage-playbook.md).
