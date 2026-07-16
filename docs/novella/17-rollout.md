# 17 — Regressions, manual validation, and rollout

> **Revision 6 changes:** manual steps for termination acks, partial-delivery ends, and reload-safety of epochs/tombstones; the M3 gate now includes the link-layer mesh scenarios (decision recovery, divergent-view elections, ack rounds). The CI requirement stands — and remains unmet on the reviewed commit, so it is repeated: **no milestone gate passes without visible GitHub status checks.**

## Existing-feature regressions

- Send chat before/during/after story transitions.
- Start/stop microphone while choices are visible.
- Video and screen-share display (`RoomVideoDisplay` with `userId`/`width`/`height`) remains rendered and functional alongside an active story.
- Open a DM dialog during an active story: the DM `Room` mounts no novella receiver, sends no bootstrap request, and does not disturb the group-room replica or lifecycle handlers.
- File sharing and direct-message navigation remain functional.
- Public and password-protected rooms work without logging secrets.
- Removing novella handlers does not flush audio/video/chat lifecycle handlers (keyed removal, never `flush()`).

## Manual matrix

### Two windows / different profiles

1. Start the development stack; join the same room in isolated profiles; confirm voice and text chat.
2. Start the example story from A; confirm the brief "agreeing on a story…" phase, then a shared session.
3. **Click start in both windows at once**; confirm exactly one session installs on both (coordinator commit), and note which candidate won.
4. Request actions from both peers; confirm identical scene/dialogue/revision after every action.
5. **Switch stories from the controller**; confirm the participant follows to the new session; attempt the switch from the participant — refused locally, no effect anywhere.
6. **Leave the story from the participant**; drive the story from the controller and confirm the participant is *not* pulled back; rejoin explicitly and confirm convergence (including immediately after clicking rejoin — the snapshot race).
7. Refresh the participant; verify the read-only checkpoint preview, then bootstrap recovery.
8. Close the controller; verify the election converges (survivor shows "You control the story") with the full latest state, and that a story switch beforehand is never undone by the election.
9. **End the story from the controller**; both peers reach the lobby; refresh both and confirm the ended session does not resurrect — from checkpoints *or* from a lagging third window holding old state (persisted epoch/tombstone meta).
10. Repeat the end with devtools network throttled so the end envelope stalls: confirm the "ending the story…" pending state, that a participant request is answered with the end notice, that the round completes only after the ack arrives, and that closing the unacked participant also completes it.

### Same-network devices

HTTPS/secure-context development URL. Portrait/landscape, microphone permissions, backgrounding, reconnect.

### Different-network devices

Configured TURN. Record direct/relay status and latency. A failed peer connection without working TURN is a connectivity limitation, not necessarily a novella protocol defect.

## README additions

- Local startup and two-profile test setup; starting a story from the room URL.
- Protocol semantics: authorization matrix, pre-dispatch gate, start rounds, session epochs, frozen election rounds, termination protocol, participation.
- Threat model statement (00): crash-fault tolerant among honest room members; not Byzantine; signed-digest hardening as future work.
- Story schema (including the effect-variable bounds), safe asset rules, catalog registration, example story.
- Late join (bootstrap), refresh, checkpoint pointer, "Reset local novella data".
- Browser autoplay and independent story volume controls.
- Tracker/STUN/TURN/ad-blocker/cross-domain limitations.
- Privacy: no central progress storage, accounts, or analytics.

## Rollout sequence

1. Merge models + normalizing/semantic validators + **limit-enforcing engine** + example story behind no visible UI. Gate: validator/engine matrices (16) green, including the engine/validator consistency property.
2. Add local-only UI behind a development feature flag.
3. Add two-peer sync: transport interface, pre-dispatch gate, exhaustive authorized dispatch, **start rounds**, engine replay, snapshots, recovery. Gate: dispatcher + start-round matrices green **and the suites running as visible GitHub status checks on the PR**.
4. Add **election rounds, epochs end-to-end (persisted meta), termination ack rounds, participation, checkpoints wired**, `CONTROL_*`. Gate: election/termination/persistence-integration matrices green in CI, **including the link-layer mesh scenarios** — partial-commit recovery, divergent-view convergence, "send resolved ≠ applied", and the reload round-trip (16).
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

All five must also run in CI on the feature branch — a reviewer should see green status checks, not run the gate locally on faith.

Review the final diff for secrets, private URLs, external trackers, analytics, raw HTML, executable story content, unbounded payloads, unlicensed assets, duplicate room/microphone creation, and unrelated formatting.
