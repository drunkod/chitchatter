# 14 — Assets, audio, and nonprotocol UI resources

> **Revision 13 changes:** proof and safety phases must not leak or unnecessarily reload assets, and protocol pages carry no asset data.

Story manifests may reference bundled assets and explicitly allowlisted same-origin/HTTPS extensions. Reject executable URLs, raw HTML, oversized data URLs, unsafe MIME types, and path traversal.

## Images

- preload only current/next scene assets;
- set bounded dimensions and safe fallbacks;
- never persist image bytes in protocol metadata, transitions, proofs, or checkpoints;
- proof assembly and safety phases keep the current safe background or neutral placeholder.

## Audio

- user gesture starts playback;
- one novella-owned audio controller;
- stop/fade on story/session change, end, navigation, or unmount;
- proof assembly does not repeatedly restart audio;
- after supersession proof, wait for exact active state before selecting successor audio;
- audio failures remain local and never affect state digest or protocol authorization.

## Accessibility

- dialogue and recovery messages use appropriate live regions;
- controls remain keyboard operable;
- motion/audio preferences are respected;
- proof page counts and reset-required states are understandable without color;
- rollback, ended, and safety messages describe what actually happened.

## Tests

- unsafe asset URLs reject;
- audio cleanup is novella-scoped;
- page reorder does not trigger repeated asset/audio transitions;
- state recovery changes assets only after canonical state install;
- chat/media/file features remain usable during proof and safety phases.
