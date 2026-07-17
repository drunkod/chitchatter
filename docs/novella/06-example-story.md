# 06 — Bundled example story and protocol fixtures

> **Revision 12 changes:** the example remains local and declarative, while its tests now provide RFC 8785, transition-chain, and supersession fixtures.

Bundle one versioned story such as `lantern-room@1` with:

- at least three scenes;
- linear dialogue plus one required choice;
- boolean, string, and numeric variables;
- conditional branches and effects;
- one safe same-origin image and optional local audio cue;
- deterministic restart and ending paths.

Story JSON contains no executable code, raw HTML, remote scripts, room secrets, or user data.

## Required fixtures

- exact revision-0 initial state;
- two equal-priority divergent states whose SHA-256 tie-break is known;
- control-character, non-ASCII, `-0`, and exponent-number JCS vectors;
- A→B→C transition certificates across two bundled story versions;
- A→B followed by B completed-end evidence;
- one floor-only state and matching `STATE_FLOOR_GOSSIP` fixture;
- two migration records with interleaved advertisements;
- metadata near operational byte limit with reserved durable capacity lock.

## Catalog rules

- exact `(storyId, storyVersion)` lookup;
- immutable normalized manifests;
- bounded assets and text;
- unknown version enters recoverable lobby;
- example assets use same-origin paths and safe media types.

## Tests

- parse and semantic validation;
- every scene/entry/choice reference;
- deterministic engine walk;
- RFC 8785 bytes and digest snapshots;
- transition and supersession chain verification;
- no remote/script/raw-HTML content.
