# 06 — Bundled example story and protocol fixtures

> **Revision 13 changes:** adds compact-certificate, proof-page, derived-ID, and transcript fixtures alongside the bundled story.

Ship one local declarative story that exercises:

- linear dialogue and explicit choices;
- conditional branches;
- string, boolean, and numeric variables;
- restart and controller change;
- audio/image assets through local or allowlisted URLs;
- enough history and variables to test snapshot truncation.

## Catalog

The catalog resolves exact `(storyId, storyVersion)` and rejects duplicates, unknown versions, malformed manifests, raw HTML, executable content, unsafe URLs, and impossible transitions.

## Canonical fixtures

Commit byte-exact fixtures for:

- RFC 8785 property order, escapes, Unicode, `-0`, exponent thresholds, and shortest numbers;
- semantic state JCS bytes and SHA-256 digest;
- each protocol-ID domain;
- compact initial, switch, and start-after-ended transitions;
- progressed and ended current-outcome dominance over one origin transition;
- proof manifests and page digest chains;
- migration record, shared round, advertisements, and transcript winner.

Browser and Node tests consume the same fixture bytes and expected lowercase hexadecimal IDs.

## Size fixtures

Provide near-limit fixtures for:

- 64 KiB state snapshot;
- maximum compact transition certificate;
- proof page at page payload budget;
- final proof page with current outcome/end evidence;
- migration transcript at maximum advertisement count.

Every fixture must remain below its declared payload/envelope limit after real serialization.
