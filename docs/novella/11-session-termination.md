# 11 — Termination, embedded predecessor proofs, dispositions, and supersession pages

> **Revision 13 changes:** start-after-ended transitions embed their end proof, current outcome may end after arbitrary progress, and stale-peer responses are paginated without full state.

## Original end and ACK

Controller creates one exact-next-revision `SESSION_ENDED { sessionEpoch }`, freezes recipients, retains authority/state, resends the same action ID, and finalizes after every frozen recipient ACKs or leaves.

## First application

One transaction:

- upserts ended disposition with end action ID;
- stores exact completed-end certificate;
- marks matching current outcome ended while preserving latest floor;
- clears active origin and migration lineage;
- cancels same-epoch conflicts/recovery;
- installs null.

The winning epoch transition remains the revision-0 origin certificate and becomes sealed when the outcome ends.

## Re-ACK and holder gossip

A resent original end matching a retained current/historical certificate re-ACKs before disposition checks. Holder end gossip contains the exact completed certificate. Retirement gossip with reason ended rejects.

## Start-after-ended dependency

When a later epoch starts after this ended epoch, its transition embeds a normalized copy of this completed-end certificate. The standalone historical certificate/disposition pair may later compact without invalidating the transition.

Compaction rules:

- never trim current-high-water end evidence;
- never mutate embedded transition proof;
- standalone historical pair trims only together;
- a malformed mismatch blocks metadata.

## Supersession response

For any authenticated below-high-water subject, holder creates paginated compact transition proof:

- chain begins immediately after requested epoch;
- final current evidence names active origin/floor or ended certificate;
- no full current state is embedded;
- active receiver exact-recovers state after proof completion;
- ended receiver installs null and closed outcome.

A progressed/ended current outcome is validated as dominating the final transition’s revision-0 origin.

## Capacity failure

If end/current evidence cannot fit:

1. abort the evidence mutation;
2. persist compact capacity lock using reserved headroom;
3. disable novella installs/controls;
4. permit higher proof only for a recoverable lock code whose preflight fits;
5. require reset for transition-limit/digest-collision;
6. preserve chat/media/files.

## Tests

- dropped ACK/reload/resend;
- ended without certificate never terminal;
- end after revision 20 validates against revision-0 transition;
- embedded predecessor proof survives standalone certificate compaction;
- active and ended paginated supersession;
- proof page loss/reorder/duplicate;
- end evidence overflow persists correct lock code and policy.
