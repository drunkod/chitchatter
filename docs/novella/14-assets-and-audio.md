# 14 — Safe assets and local audio

> **Revision 12 changes:** asset behavior remains isolated from protocol state; supersession and safety recovery never auto-play stale media.

## Assets

- bundled or explicitly permitted same-origin URLs only;
- reject scriptable/HTML/SVG content unless separately sanitized and allowlisted;
- bounded URL/text/media metadata;
- no room secrets, invite URLs, peer IDs, or progress values embedded in asset requests;
- failed image/audio loads do not change canonical story state.

## Audio

- playback is local UI behavior, never replicated authority;
- require user gesture before audio context activation;
- stop/fade on scene change, rollback, supersession, end, room navigation, and safety lock;
- floor-only recovery displays no speculative successor audio;
- stale checkpoint or transition chain does not trigger audio until exact canonical state installs;
- cleanup touches only novella-owned nodes/timers.

## Tests

- safe/unsafe URL and media-type validation;
- rollback/supersession/end/safety lock stops audio;
- room navigation removes old audio;
- recovery/floor evidence alone never starts playback;
- existing chat/media streams remain unaffected.
