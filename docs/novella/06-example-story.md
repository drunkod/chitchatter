# 06 — Bundled example story and catalog

> **Revision 9:** no protocol change. This step remains the deterministic fixture used by engine, semantic-validator, replay, reconciliation, and UI tests.

## Package layout

```text
src/stories/example-story/
  story.json
  backgrounds/
  characters/
  audio/
```

The manifest is declarative and versioned. Asset references are same-origin relative paths. No script, HTML, remote URL, analytics, or executable extension is allowed.

## Fixture requirements

The example contains:

- at least two scenes and two endings;
- an explicit next link and an implicit next entry;
- a required choice;
- string, boolean, and numeric effects;
- one conditional branch;
- background, character, portrait, music, and sound references;
- stable IDs suitable for deterministic snapshots.

## Catalog

`getBundledStory(id, version)` returns only a deep-normalized manifest that already passed `validateStory`. Missing exact versions are recoverable lobby errors, not fallback to a different version.

## Tests

- fixture validates and every asset resolves;
- engine reaches both endings deterministically;
- all expected snapshots pass structural and semantic validation;
- catalog refuses unknown version;
- mutating imported/raw fixture data cannot mutate the catalog result.
