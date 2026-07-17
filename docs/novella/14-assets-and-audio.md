# 14 — Asset resolution, preload, and local audio

> **Revision 8:** no protocol change. Reconciliation and completed-end rollback continue to use only locally resolved assets and stop obsolete audio immediately.

- Resolve assets only from the validated bundled story root.
- Reject traversal, scheme-relative, cross-origin, malformed, and unsupported-extension paths during story validation.
- Preload bounded current/near-next visual assets; failures show fallbacks and never block protocol state.
- Music and sound are local presentation effects. Asset bytes and playback position never enter envelopes.
- Respect browser autoplay policy, user mute/volume preferences, and reduced-motion/accessibility settings.
- On story switch, reconciliation, restart, end, or completed-end certificate, stop/fade obsolete audio and start the newly rendered scene's local audio without changing canonical state.
- Cleanup object URLs, event handlers, and audio nodes on unmount.
