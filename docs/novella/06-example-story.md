# 06 — Bundled example story and catalog

> **Revision 8:** no protocol change. Fixtures are referenced by the expanded reconciliation, persistence, and end-certificate tests.

Ship one small declarative bundled story that exercises:

- sequential dialogue;
- a required choice with conditions and effects;
- at least two endings;
- background, portrait/sprite, music, and sound references;
- restart and controller migration without changing story identity.

The catalog exposes normalized manifests by exact `(storyId, storyVersion)`. Missing or changed versions make persisted/network state unavailable rather than silently substituting another story.

## Required fixtures

Alongside the production example, tests may construct bounded in-memory fixtures for:

- invalid scene/entry/choice/history references;
- all choices condition-gated with no fallback;
- too many effect variables or encoded variable bytes;
- non-finite increment result;
- equal session/epoch/revision states with different branch/variables for reconciliation;
- maximal legal UTF-8 snapshot sizes.

No asset bytes travel in protocol envelopes.
