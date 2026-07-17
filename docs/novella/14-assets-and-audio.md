# 14 — Safe assets, preload, and local audio

> **Revision 10 changes:** no distributed protocol change. Asset/audio state remains outside canonical comparison and follows the transaction-owned session identity.

## Asset resolution

Stories reference logical asset IDs. The bundled catalog resolves those IDs to application-controlled same-origin URLs. Reject path traversal, unsupported schemes, raw HTML, scriptable SVG when not explicitly sanitized, and unbounded metadata.

Asset bytes never travel in novella envelopes or RoomMeta.

## Preload

Preload the current scene plus a small bounded lookahead. Abort stale preloads on room/session/story change. Failed images/audio show accessible fallback without mutating canonical story state.

## Audio

Audio playback is local preference only:

- user gesture unlocks playback;
- mute/volume are local settings;
- scene/BGM changes derive from canonical state but playback position is not synchronized;
- cleanup stops/fades audio on unmount, switch, end, or rollback;
- no microphone/media-room changes.

## Identity

A same-session state cannot change story ID/version, so asset resolution cannot silently jump catalogs during reconciliation. New story identity arrives only through authorized new-session start/switch.

## Accessibility

Provide captions/transcripts for meaningful audio where authored, alt text for story images, visible focus, keyboard controls, reduced-motion behavior, and no autoplay surprise.

## Tests

- same-origin allowlist and traversal rejection;
- abort on rapid state/room changes;
- missing asset fallback;
- rollback/switch/end audio cleanup;
- local mute/volume never enters protocol state;
- immutable session story identity selects one catalog.
