# Novella browser demo and human test playbook

Use this playbook to demonstrate and manually validate the Novella MVP in real browsers. It focuses on user-visible behavior rather than protocol internals.

## Test objective

Confirm that two or more people can read **Harbour Lights** together in a public group room while normal Chitchatter features continue to work.

The MVP is intentionally ephemeral. Story state exists only while peers remain in the room; it is not persisted after everyone leaves.

## Prerequisites

- Node.js and project dependencies are installed.
- The browser permits WebRTC and local network access.
- Camera and microphone permissions can be granted for media checks.
- Use real browser sessions rather than automation-controlled Chrome for peer-to-peer checks.

Use two isolated sessions so each participant has a separate identity:

- Chrome normal window and Chrome Incognito;
- two Chrome profiles; or
- Chrome and Firefox.

Two ordinary tabs in the same browser profile are not recommended for identity, refresh, or recovery testing.

## Start the application

From the repository root, start the full local stack with Novella enabled:

```bash
VITE_ENABLE_NOVELLA=true npm run dev
```

Open:

```text
http://localhost:3000
```

The full development stack is preferred because it starts the frontend and local WebTorrent tracker. If the interactive development supervisor is unsuitable, use the E2E stack:

```bash
VITE_ENABLE_NOVELLA=true npm run start:e2e
```

## Prepare the room

### Browser A — storyteller

1. Open the homepage.
2. Note the generated username.
3. Click **Join public room**.
4. Copy the room URL.
5. Confirm the **Novella** panel displays **Harbour Lights**.
6. Do not start the story yet.

### Browser B — participant

1. Open the copied room URL in an isolated browser session.
2. Wait until both users appear in the peer list.
3. Confirm the connection status does not report that the pairing server is unavailable.
4. Send a chat message from Browser A to Browser B.
5. Reply from Browser B.

Do not continue if chat does not propagate. A failed baseline room connection prevents meaningful Novella synchronization testing.

## Demo script

### 1. Start and synchronize the story

In Browser A:

1. Click **Start story**.
2. Confirm both browsers show the same opening dialogue.
3. Confirm Browser A is labeled as the storyteller.
4. Confirm Browser B does not receive independent storyteller controls.

Expected result: both browsers show revision 0 and the same dialogue.

### 2. Let a participant advance

In Browser B:

1. Click **Continue**.
2. Confirm both browsers advance to the choice prompt.

Expected result: the participant request travels through the storyteller, and both browsers show revision 1.

### 3. Complete the beacon branch

In Browser B:

1. Click **Light the old beacon**.
2. Confirm both browsers show the beacon dialogue.
3. Click **Continue**.
4. Confirm both browsers reach the same ending.

Expected result: both browsers reach the beacon ending at revision 3 and show **Read again**.

### 4. Complete the dawn branch

1. Click **Read again**.
2. Confirm both browsers return to the opening dialogue.
3. Click **Continue**.
4. Select **Wait together for dawn**.
5. Click **Continue**.
6. Confirm both browsers reach the ending containing:

```text
Slowly, the boat follows it home.
```

Expected result: both Harbour Lights branches synchronize successfully.

## Recovery tests

### Late join

1. Keep Browsers A and B connected.
2. Advance the story beyond the opening dialogue.
3. Open Browser C in another isolated session.
4. Join the same room URL.

Expected result:

- Browser C receives the current story snapshot.
- Browser C displays the current dialogue rather than starting at revision 0.
- Browser C does not expose a usable **Start story** button while recovery is pending.

### Refresh recovery

1. Advance the story several revisions.
2. Refresh Browser B.
3. Wait for it to reconnect as a new peer identity.

Expected result: Browser B recovers the current story state from the storyteller. No local persistence is expected or required.

### Simultaneous bootstrap

1. Progress the story in Browser A.
2. Open Browsers B and C at approximately the same time.
3. Repeat with both joining browsers throttled to **Slow 3G** in DevTools.

Expected result:

- Both joining browsers recover the active session.
- A negative response from an empty joining peer does not override the storyteller's snapshot.
- Neither joining browser incorrectly starts an independent story.

### Storyteller departure and claim

1. Confirm Browser A is the storyteller.
2. Close Browser A completely.
3. Observe Browsers B and C.

Expected result:

- The story pauses.
- The UI explains that the storyteller left.
- Only the lowest eligible connected peer sees **Continue the story**.

On that peer:

1. Click **Continue the story** once.
2. Advance the dialogue.

Expected result: control transfers and all remaining peers continue from the same story state.

## Room navigation throttle

1. Join public room A.
2. Immediately navigate to public room B.
3. Immediately return to room A.

Expected result:

- The mount delay/backoff applies to every navigation attempt, including returning to a previously allowed room.
- The old room does not briefly remount.
- Duplicate peer connections are not created.

## Regression checklist

Run these checks while a story is active:

- [ ] Chat messages propagate in both directions.
- [ ] Microphone can be enabled and disabled.
- [ ] Camera activation renders the video display without hiding or resetting Novella.
- [ ] Screen sharing can start and stop.
- [ ] File-sharing controls remain available.
- [ ] Opening a direct-message room does not mount a second Novella runtime.
- [ ] Returning to the group room preserves the active in-memory story.
- [ ] Ending the story shows the fresh-session prompt.
- [ ] Starting again creates a new revision-0 session.
- [ ] Mobile portrait layout remains usable.
- [ ] Mobile landscape layout remains usable.
- [ ] No new uncaught console errors appear during story actions.

## Ephemeral-session check

1. Close every browser in the room.
2. Wait for all peer connections to disappear.
3. Open the same room URL again.

Expected result: the previous story is gone and a new story can be started. This is intentional MVP behavior.

## Failure triage

### Pairing server unavailable

Before reporting a Novella synchronization defect, verify that ordinary chat works between the same browsers. Check:

- the local tracker is running;
- the browser gathers WebRTC ICE candidates;
- local network and WebRTC access are permitted;
- a VPN, firewall, privacy extension, or browser automation policy is not blocking peer discovery.

A tracker can see two clients even when the browsers fail to establish the subsequent WebRTC connection.

### Joining peer remains at the lobby

Record:

- storyteller and participant usernames;
- current room URL without private secrets;
- visible revision on each browser;
- whether chat still works;
- browser console errors;
- network throttling state;
- whether the peer joined late, refreshed, or joined simultaneously with another peer.

### Story state diverges

Stop clicking and capture screenshots of every browser. Record the dialogue, revision, storyteller label, and available controls on each peer before refreshing.

## Test result template

```text
Date:
Commit/build signature:
Operating systems:
Browsers and versions:
Number of peers:
Room type: public group room
Local tracker or deployed environment:

Beacon branch: PASS / FAIL
Dawn branch: PASS / FAIL
Participant actions: PASS / FAIL
Late join: PASS / FAIL
Refresh recovery: PASS / FAIL
Simultaneous bootstrap: PASS / FAIL
Storyteller handoff: PASS / FAIL
Rapid room navigation: PASS / FAIL
Chat regression: PASS / FAIL
Audio/video regression: PASS / FAIL
Direct-message isolation: PASS / FAIL
Ephemeral-session behavior: PASS / FAIL
Console clean: PASS / FAIL

Notes and reproduction steps:
```

## Automated follow-up

After the human test, run the Novella browser suite:

```bash
npm run test:e2e -- e2e/tests/visual-novel.test.ts
```

Run the full repository gate before publishing changes:

```bash
npm run check:types
npm test -- --run
npm run lint
npm run build
npm run test:e2e
```
