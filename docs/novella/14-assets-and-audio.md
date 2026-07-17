# 14 — Safe assets and local audio

> **Revision 9:** no protocol change. Asset and audio behavior remains local and must survive reconciliation without affecting canonical state.

## Asset resolution

Resolve only manifest-declared, same-origin relative assets under the bundled story root. Reject traversal, protocol-relative paths, unsupported extensions, and unknown asset keys. Asset bytes never travel in novella envelopes.

Preload the current scene plus bounded likely-next assets. Failed optional audio does not block state synchronization; missing required visual assets surface an accessible story error.

## Audio

Music and sound effects are local presentation:

- user gesture unlocks playback;
- local mute/volume preferences are not canonical story variables;
- scene changes cross-fade/cancel prior audio;
- reconciliation/end stops obsolete timeline audio before rendering the new state/lobby;
- cleanup releases element/event references.

## Accessibility

Images have authored alternatives where meaningful; decorative art is hidden from assistive technology. Dialogue remains readable with assets/audio disabled. Reduced-motion and mute preferences are respected.

## Tests

- path traversal/cross-origin/extension rejection;
- preload boundedness and cancellation;
- no audio autoplay before gesture;
- reconciliation and completed-end cleanup;
- asset failure never mutates canonical state or chat/media controls.
