# Novella MacBook browser test playbook

Use this playbook to validate the Novella MVP manually on macOS and to distinguish an application defect from a browser-specific WebRTC restriction.

The primary acceptance environment is current Chrome or Chromium using isolated browser identities. Helium is useful for compatibility diagnostics, but it must not be the only release gate unless its ICE probe produces usable candidates.

## Test objectives

Confirm that:

- two real browser identities can discover each other and exchange chat;
- both **Harbour Lights** branches remain synchronized;
- a late join and a refreshed participant recover the current snapshot;
- storyteller departure pauses the story and one click resumes it;
- camera, microphone, chat, peer list, and direct messages still work;
- closing every peer discards the story, as required by the ephemeral MVP;
- browser-specific WebRTC failures are recorded separately from Novella failures.

## Recommended browser matrix

Use this order:

1. Chrome normal window and Chrome Incognito — primary MacBook acceptance check.
2. Chrome and Firefox — cross-browser compatibility check.
3. Chrome on the Mac and a physical phone — optional network/device check.
4. Helium — diagnostic compatibility check only after running the ICE probe.

Do not use two ordinary tabs in one profile as the only test. Separate profiles or private browsing produce separate Chitchatter identities and make refresh/rejoin behavior more realistic.

## Prerequisites

From the repository root, confirm the branch and Node environment:

```bash
git switch novella
git pull --ff-only

nix shell nixpkgs#nodejs_24 --command node --version
nix shell nixpkgs#nodejs_24 --command npm --version
```

Install the locked dependencies:

```bash
nix shell nixpkgs#nodejs_24 --command npm ci
```

Install Chromium for automated follow-up when needed:

```bash
nix shell nixpkgs#nodejs_24 --command npx playwright install chromium
```

Record the build under test:

```bash
git rev-parse HEAD
git status --short
```

Manual release testing should normally use a clean working tree.

## macOS permissions

Open **System Settings → Privacy & Security** and verify the test browsers under:

- Local Network;
- Camera;
- Microphone;
- Screen Recording, when testing screen sharing.

Restart a browser after changing its permission. Temporarily disable VPNs or aggressive privacy extensions when diagnosing peer discovery, then restore them after the test.

## Preflight: clear stale local services

Check the three local ports before starting:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:3003 -sTCP:LISTEN
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

When an old Chitchatter process is present, stop it normally:

```bash
kill <PID>
```

Wait and check the port again. Use `kill -9` only when the process does not respond to a normal signal.

## Start the manual stack

For the easiest setup, run the combined stack in one Terminal:

```bash
nix shell nixpkgs#nodejs_24 --command \
  env VITE_ENABLE_NOVELLA=true npm run start:e2e
```

Keep that Terminal open. Verify:

```bash
curl -I http://localhost:3000
curl http://localhost:3000/api/get-config
lsof -nP -iTCP:3000,3003,8000 -sTCP:LISTEN
```

Expected services:

```text
3000  Vite web application
3003  local RTC configuration API
8000  WebTorrent tracker
```

### Separate-terminal mode

Use separate Terminals when diagnosing startup or shutdown.

Terminal 1 — RTC configuration API:

```bash
cd /Users/test/Documents/work/chitchatter
nix shell nixpkgs#nodejs_24 --command \
  env IS_E2E_TEST=true node simple-api-server.js
```

Terminal 2 — local tracker:

```bash
cd /Users/test/Documents/work/chitchatter
nix shell nixpkgs#nodejs_24 --command npx bittorrent-tracker
```

Terminal 3 — Vite with Novella enabled:

```bash
cd /Users/test/Documents/work/chitchatter
nix shell nixpkgs#nodejs_24 --command \
  env \
    IS_E2E_TEST=true \
    VITE_IS_E2E_TEST=true \
    VITE_ENABLE_NOVELLA=true \
    VITE_RTC_CONFIG_ENDPOINT=/api/get-config \
    VITE_TRACKER_URL="ws://127.0.0.1:8000" \
    npx vite --port 3000 --logLevel info
```

Open `http://localhost:3000` only after all three services are listening.

## Prepare two browser identities

### Browser A — storyteller

1. Open Chrome normally.
2. Navigate to `http://localhost:3000`.
3. Record the generated username.
4. Click **Join public room**.
5. Copy the complete room URL.
6. Confirm the **Novella** region shows **Harbour Lights**.
7. Do not start the story yet.

### Browser B — participant

1. Open Chrome Incognito with **File → New Incognito Window**.
2. Paste the complete room URL from Browser A.
3. Record the generated username.
4. Wait for both users to appear in the peer list.
5. Send a chat message from A to B.
6. Reply from B to A.

Stop here when chat does not propagate. A failed chat baseline means peer discovery or WebRTC is not ready, so Novella synchronization results are not meaningful.

## Test 1 — start and participant advance

In Browser A:

1. Click **Start story**.
2. Confirm both browsers show the opening dialogue.
3. Confirm A is identified as the storyteller.
4. Confirm B does not receive independent storyteller controls.

In Browser B:

1. Click **Continue** once.
2. Confirm both browsers show the choice prompt.
3. Confirm neither browser advances twice.

Expected result: both peers display the same dialogue and revision after the participant request is sequenced by the storyteller.

## Test 2 — complete both branches

### Beacon branch

In Browser B:

1. Select **Light the old beacon**.
2. Confirm both browsers show the gold-light dialogue.
3. Click **Continue**.
4. Confirm both reach the boat-flashes ending.

### Dawn branch

1. Click **Read again**.
2. Confirm both peers return to the opening dialogue.
3. Click **Continue**.
4. Select **Wait together for dawn**.
5. Click **Continue**.
6. Confirm both peers reach:

```text
Slowly, the boat follows it home.
```

Expected result: both branches converge in both browser identities.

## Test 3 — late join

1. Keep A and B connected.
2. Restart the story and progress beyond the opening dialogue.
3. Open Browser C using Firefox Private Browsing or another Chrome profile.
4. Join the same room URL.
5. Do not click **Start story** in C.

Expected result:

- C receives the current snapshot;
- C shows the current dialogue rather than revision 0;
- C does not create a competing session;
- chat still works between C and an existing peer.

## Test 4 — participant refresh

1. Progress the story several revisions.
2. Refresh Browser B with **Command-R**.
3. Wait for B to reappear in the peer list.
4. Confirm B recovers the current dialogue.
5. Send a new chat message from A to B.

Expected result: refresh behaves as a new peer join and recovers from another live peer. No local persistence is expected.

## Test 5 — storyteller departure and claim

Use A, B, and C when possible.

1. Confirm A is the storyteller.
2. Close A completely.
3. Observe B and C without clicking immediately.
4. Confirm the story pauses and explains that the storyteller left.
5. Confirm only the eligible lowest peer shows **Continue the story**.
6. Click **Continue the story** once.
7. Wait for the storyteller indicator to update.
8. Advance once.

Expected result: the remaining peers converge and continue from the paused state.

## Test 6 — host-room regressions

While a story is active, verify:

- [ ] chat messages propagate both ways;
- [ ] microphone can be enabled and disabled;
- [ ] camera activation keeps `RoomVideoDisplay` visible;
- [ ] screen sharing starts and stops when permission is granted;
- [ ] the peer list opens and closes;
- [ ] selecting a peer opens a direct-message dialog;
- [ ] the direct-message dialog contains no Novella region;
- [ ] returning to the group room preserves the active in-memory story;
- [ ] no new uncaught console error appears during story actions.

## Test 7 — ephemeral room boundary

1. Close every browser in the room.
2. Wait for peer connections to disappear.
3. Reopen the same room URL.

Expected result: the previous story is gone and a fresh story can be started. This is intentional MVP behavior.

## Browser console and evidence capture

Open DevTools with **Option-Command-I**. Preserve evidence before refreshing when peers diverge.

Record:

- commit SHA;
- macOS version;
- browser names and versions;
- usernames and number of peers;
- visible dialogue and revision on every peer;
- which browser was storyteller;
- exact action immediately before failure;
- whether chat still worked;
- console errors;
- screenshots of every peer;
- VPN, extension, permission, and network-throttling state.

Do not publish private room secrets or sensitive messages in an issue.

## Automated follow-up

Stop the manual stack before running Playwright. The Playwright configuration starts its own deterministic server with Novella enabled and does not reuse an arbitrary process on port 3000 by default.

Check the ports:

```bash
lsof -nP -iTCP:3000,3003,8000 -sTCP:LISTEN
```

Run the focused suite:

```bash
nix shell nixpkgs#nodejs_24 --command \
  npx playwright test e2e/tests/visual-novel.test.ts \
    --project=chromium \
    --workers=1 \
    --trace=on \
    --headed
```

Both scenarios must pass in the same run:

```text
shares both Harbour Lights branches without regressing chat, video, or DMs
recovers a late join and refresh, then continues after controller departure
```

Open the HTML report when one was produced:

```bash
nix shell nixpkgs#nodejs_24 --command npx playwright show-report
```

Open a trace:

```bash
nix shell nixpkgs#nodejs_24 --command \
  npx playwright show-trace test-results/<result-directory>/trace.zip
```

### Explicitly reuse a known-good manual server

Reusing an existing server is opt-in. Only do this when it was started with the same Novella and tracker settings:

```bash
PLAYWRIGHT_REUSE_EXISTING_SERVER=true \
  nix shell nixpkgs#nodejs_24 --command \
  npx playwright test e2e/tests/visual-novel.test.ts --workers=1
```

## Helium compatibility diagnostic

A successful tracker WebSocket does not prove that a browser can establish WebRTC. The tested Helium configuration opened the tracker but returned no ICE candidates, so it could not be used as a local Novella acceptance peer.

Run this probe through CDP when Helium is listening on port 9222:

```javascript
const { chromium } = require('playwright')

async function probeHeliumIce() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const context = browser.contexts()[0]
  const page = await context.newPage()

  try {
    await page.goto('http://localhost:3000')

    const candidates = await page.evaluate(async () => {
      const iceServer = await fetch('/api/get-config').then(response => {
        if (!response.ok) {
          throw new Error(`RTC config request failed: ${response.status}`)
        }

        return response.json()
      })

      return new Promise((resolve, reject) => {
        const peerConnection = new RTCPeerConnection({
          iceServers: [iceServer],
        })
        const gathered = []
        const timeout = window.setTimeout(() => {
          peerConnection.close()
          reject(new Error('ICE gathering timed out'))
        }, 15_000)

        peerConnection.createDataChannel('ice-probe')
        peerConnection.addEventListener('icecandidate', event => {
          if (event.candidate) {
            gathered.push({
              candidate: event.candidate.candidate,
              type: event.candidate.type,
              protocol: event.candidate.protocol,
            })
            return
          }

          window.clearTimeout(timeout)
          peerConnection.close()
          resolve(gathered)
        })

        peerConnection
          .createOffer()
          .then(offer => peerConnection.setLocalDescription(offer))
          .catch(error => {
            window.clearTimeout(timeout)
            peerConnection.close()
            reject(error)
          })
      })
    })

    console.log(JSON.stringify(candidates, null, 2))
  } finally {
    await page.close()
    await browser.close()
  }
}

probeHeliumIce().catch(error => {
  console.error(error)
  process.exitCode = 1
})
```

Interpret the result:

- `host` — a local interface candidate was gathered;
- `srflx` — a STUN-derived address was gathered;
- `relay` — a TURN relay candidate was gathered;
- `[]` — the browser cannot participate in this WebRTC environment.

When Helium returns `[]`, record it as a browser compatibility limitation and perform the release acceptance test in supported Chrome/Chromium contexts. Do not classify the empty candidate list as a Novella protocol defect.

## Human test result template

```text
Date:
Tester:
Commit SHA:
Working tree clean: YES / NO
macOS version:
Browser A/version:
Browser B/version:
Browser C/version:
Environment: combined stack / separate terminals / deployed preview
VPN or privacy extensions:

Ports 3000/3003/8000 healthy: PASS / FAIL
Peer discovery: PASS / FAIL
Chat baseline: PASS / FAIL
Beacon branch: PASS / FAIL
Dawn branch: PASS / FAIL
Participant actions: PASS / FAIL
Late join: PASS / FAIL
Refresh recovery: PASS / FAIL
Storyteller handoff: PASS / FAIL
Camera/microphone: PASS / FAIL / NOT RUN
Screen sharing: PASS / FAIL / NOT RUN
Direct-message isolation: PASS / FAIL
Ephemeral room behavior: PASS / FAIL
Console clean: PASS / FAIL
Focused Playwright suite: PASS / FAIL
Helium ICE probe: candidate types / empty / NOT RUN

Notes, screenshots, and reproduction steps:
```

## Clean shutdown

Press **Control-C** in each service Terminal. Then verify that no local test process remains:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:3003 -sTCP:LISTEN
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

Restore VPN, privacy extensions, network throttling, and browser permissions changed only for diagnostics.
