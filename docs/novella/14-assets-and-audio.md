# 14 — Safe assets and local audio

> **Revision 11 changes:** no protocol payload carries binary assets or synchronized playback; audio now follows canonical-store generation and safety phases so stale tabs cannot continue scene audio after successor/end recovery.

## Assets

Story manifests reference bounded asset IDs resolved through a same-origin catalog. Validate MIME expectations, URL/path allowlists, dimensions where available, and configured byte budgets. Never evaluate SVG scripts, remote HTML, or manifest-provided JavaScript.

Required story data failure blocks that story version. Optional portraits/backgrounds degrade to accessible placeholders without changing canonical state.

## Audio

Audio is local presentation only:

- no audio timestamp/playback position is replicated;
- user gesture and browser autoplay policy are respected;
- volume/mute preferences stay local;
- scene change may fade/stop previous track;
- canonical-store update, end, switch successor, external-generation recovery, safety lock, and room unmount stop stale playback immediately;
- read-only recovery may show the scene but does not auto-start new audio until canonical state is confirmed.

## Accessibility

Provide captions/transcripts for meaningful audio, visible mute/volume controls, reduced-motion-safe transitions, keyboard controls, focus management, and non-color-only state indicators.

## Tests

- malicious/unknown asset references reject or degrade safely;
- missing optional assets do not mutate state;
- old-room and old-generation audio stops on unmount/recovery;
- ended/switch successor clears prior scene audio;
- safety-lock/capability-error UI remains silent and accessible;
- chat/media streams remain unaffected by novella audio cleanup.
