# Novella compatibility and accessibility playbook

Use this playbook to verify that the synchronized story remains usable across supported browser families, viewport sizes, input methods, and assistive-technology basics.

This is a focused MVP compatibility pass. It does not certify every browser/device combination.

## Objectives

Confirm that:

- the Novella panel remains readable within the existing room layout;
- keyboard users can start, advance, choose, restart, and claim control;
- status and warning messages are perceivable;
- camera, chat, peer list, and direct messages remain usable;
- different browsers can share the same canonical story state.

## Test build

Record:

```text
Commit/build:
Environment URL:
Feature flag value:
Tester:
Date:
```

Use a build with `VITE_ENABLE_NOVELLA=true`. Keep a feature-disabled build available as a host-room comparison.

## Minimum browser matrix

Run at least these combinations when available:

| Storyteller | Participant | Purpose |
| --- | --- | --- |
| Current Chrome or Chromium | Isolated Chrome profile/incognito | baseline and media |
| Current Chrome or Chromium | Current Firefox | cross-browser WebRTC and UI |
| Desktop browser | Mobile browser or emulated mobile viewport | responsive layout |
| Normal-speed peer | Slow 3G peer | recovery/status behavior |

Safari should be included when a compatible test device is available, especially before a wider public release.

Do not treat two ordinary tabs in the same browser profile as the only identity test.

## Viewport matrix

Check at minimum:

- desktop: 1280 × 720 or larger;
- narrow desktop/tablet: approximately 768 × 1024;
- mobile portrait: approximately 390 × 844;
- mobile landscape: approximately 844 × 390;
- 200% browser zoom on desktop.

At every size, confirm:

- dialogue text is not clipped;
- choice and action buttons remain reachable;
- the chat input remains usable;
- the Novella panel does not cover the app bar or room controls;
- peer-list and direct-message surfaces can open and close;
- scrolling does not reset story state.

## Keyboard-only flow

Do not use the mouse for this section.

1. Navigate to a public room.
2. Move focus to **Start story** and activate it.
3. Move through **Continue** and the available choices.
4. Complete one branch.
5. Activate **Read again**.
6. Open and close the peer list.
7. Open a direct message and return to the group room.
8. When testing handoff, focus and activate **Continue the story**.

Expected result:

- every interactive control receives a visible focus indicator;
- tab order follows the visible room layout;
- disabled controls are skipped or announced as unavailable;
- Enter or Space activates buttons as expected;
- focus is not trapped in the Novella panel;
- opening a direct message does not duplicate Novella controls.

## Screen-reader smoke test

Use one available combination, such as VoiceOver with Safari/Chrome or NVDA with Firefox/Chrome.

Verify:

- the panel is announced as a **Novella** region;
- the story title and current dialogue are understandable in reading order;
- buttons have meaningful names such as **Start story**, **Continue**, and **Continue the story**;
- recovery and warning messages are announced or discoverable without relying only on color;
- storyteller status is understandable;
- choice labels are announced as distinct controls;
- the direct-message dialog contains no duplicate Novella region.

Record the assistive technology and browser versions. This is a smoke test, not a formal conformance audit.

## Color and visual checks

Check normal and dark appearance when supported by the app or operating system.

- Text meets a readable contrast level against its background.
- Warning and error meaning is not conveyed only by color.
- Gradient or background decoration does not obscure dialogue.
- Disabled and pending states remain distinguishable.
- At 200% zoom, no essential control is lost.
- Long translated-style text is not available yet, so use DevTools to temporarily lengthen a dialogue node only for layout inspection; do not commit modified story data.

## Reduced motion

Enable the operating system or browser preference for reduced motion.

Confirm:

- core controls still appear;
- no transition blocks reading or interaction;
- room and story state do not depend on animation completion;
- loading and recovery remain understandable.

## Media regression

With Novella active:

1. Grant camera and microphone permission.
2. Toggle the camera.
3. Confirm `RoomVideoDisplay` remains visible.
4. Toggle microphone.
5. Start and stop screen sharing when supported.
6. Send chat while the story is active.
7. Open a direct message.

Expected result: media and chat activity do not hide, duplicate, or reset the synchronized story.

## Network and permission variants

Test these separately:

- camera permission granted;
- camera permission denied;
- microphone permission denied;
- Slow 3G during late join;
- temporary offline mode on a participant;
- VPN or privacy extension enabled only when diagnosing a reported environment.

A media-permission denial must not prevent text chat or Novella use. A failed peer connection should be classified before evaluating synchronization.

## Cross-browser state check

For each browser pairing:

1. Start in one browser.
2. Advance from the other browser.
3. Choose a branch from the participant.
4. Compare dialogue and revision.
5. Refresh the participant.
6. Close the storyteller and claim from the remaining peer.

Expected result: the same canonical state is shown after each step regardless of browser family.

## Result matrix

```text
Commit/build:
Environment:

Browser/OS:
Viewport or device:
Input method:
Assistive technology:
Camera permission:
Microphone permission:
Network condition:

Panel visible and readable: PASS / FAIL
Keyboard flow: PASS / FAIL
Screen-reader smoke: PASS / FAIL / NOT RUN
200% zoom: PASS / FAIL
Mobile portrait: PASS / FAIL
Mobile landscape: PASS / FAIL
Chat regression: PASS / FAIL
Media regression: PASS / FAIL
DM isolation: PASS / FAIL
Cross-browser synchronization: PASS / FAIL
Refresh recovery: PASS / FAIL
Controller handoff: PASS / FAIL
Console clean: PASS / FAIL

Notes and screenshots:
```

## Blocking compatibility defects

Treat these as release blockers:

- essential story controls cannot be reached by keyboard;
- dialogue or choices are clipped with no scrolling path;
- status is communicated only through color;
- a supported browser consistently diverges from another peer;
- media controls remove or reset the story panel;
- direct-message rooms contain a Novella runtime;
- mobile layout prevents returning to chat or room controls.

## Follow-up

File repeatable defects using [`incident-triage-playbook.md`](./incident-triage-playbook.md). Include the exact browser/OS combination and whether the same scenario passes in another browser family.
