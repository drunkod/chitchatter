# 14 — Regressions, manual validation, and rollout

> **Revision 4 changes:** regression and manual steps for the new lifecycle semantics (arbitration, tombstones, durable leave, election rounds); rollout sequence updated to match the split milestones.

## Existing-feature regressions

- Send chat before/during/after story transitions.
- Start/stop microphone while choices are visible.
- Video and screen-share **display** (`RoomVideoDisplay` with `userId`/`width`/`height`) remains rendered and functional alongside an active story.
- Open a DM dialog during an active story: the DM `Room` mounts no novella receiver, sends no bootstrap request, and does not disturb the group-room replica or lifecycle handlers.
- File sharing and direct-message navigation remain functional.
- Public and password-protected rooms work without logging secrets.
- Removing novella handlers does not flush audio/video/chat lifecycle handlers (keyed removal, never `flush()`).

## Manual matrix

### Two windows / different profiles

1. Start the normal development stack; join the same room in isolated profiles.
2. Confirm voice and text chat.
3. Start the example story from A; confirm the brief arbitration indicator, then a shared session.
4. **Click start in both windows at once**; confirm both converge on one session.
5. Request actions from both peers; confirm identical scene/dialogue/revision after every action.
6. Attempt to start a different story from the participant — refused locally, no effect on the controller.
7. **Leave the story from the participant**; confirm the controller's next actions do *not* pull the participant back in; rejoin explicitly and confirm convergence.
8. Refresh the participant; verify checkpoint continuity then bootstrap snapshot recovery.
9. Close the controller; verify the election round converges (survivor shows "You control the story") with the **full** latest state, without restart.
10. **End the story from the controller**; both peers return to the lobby; refresh both and confirm the ended session does not resurrect from checkpoints.

### Same-network devices

HTTPS/secure-context development URL. Portrait/landscape, microphone permissions, backgrounding, reconnect.

### Different-network devices

Configured TURN. Record direct/relay status and latency. A failed peer connection without working TURN is a connectivity limitation, not necessarily a novella protocol defect.

## README additions

- Local startup and two-profile test setup; starting a story from the room URL.
- Protocol semantics: authorization matrix, start arbitration, election rounds, tombstones, participation.
- **Threat model statement (00):** crash-fault tolerant among honest room members; not Byzantine; signed-digest hardening as future work.
- Story schema, safe asset rules, catalog registration, example story.
- Late join (bootstrap), refresh, checkpoint pointer, "Reset local novella data".
- Browser autoplay and independent story volume controls.
- Tracker/STUN/TURN/ad-blocker/cross-domain limitations.
- Privacy: no central progress storage, accounts, or analytics.

## Rollout sequence

1. Merge models + normalizing/semantic validators + engine + example story behind no visible UI (M1 gate: validator/engine matrices in 13).
2. Add local-only UI behind a development feature flag.
3. Add two-peer sync: transport interface, exhaustive authorized dispatch, start arbitration, engine replay, snapshots, recovery tests (M2 gate: dispatcher matrix).
4. Add election rounds, tombstones, participation, checkpoints, `CONTROL_*` (M3 gate: mesh integration cases).
5. Production UI composition + accessibility (M4).
6. Enable the bundled example story by default after the full regression pass (M5).

## Command gate

```bash
npm test -- --run
npm run check:types
npm run lint
npm run build
npm run test:e2e -- e2e/tests/visual-novel.test.ts
```

Review the final diff for secrets, private URLs, external trackers, analytics, raw HTML, executable story content, unbounded payloads, unlicensed assets, duplicate room/microphone creation, and unrelated formatting.
