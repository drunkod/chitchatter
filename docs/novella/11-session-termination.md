# 11 — Termination, end certificates, dispositions, and supersession

> **Revision 12 changes:** historical switch recovery uses retained transition chains, below-high-water traffic always gets current evidence, and capacity overflow remains durably fail-closed.

## Original end and ACK

Controller creates one exact-next-revision `SESSION_ENDED { sessionEpoch }`, freezes recipients, retains authority/state, resends the same action ID, and finalizes after every frozen recipient ACKs or leaves.

## First application

One transaction:

- upserts ended disposition with `evidenceId = endActionId`;
- stores exact completed-end certificate;
- marks matching canonical outcome ended while preserving floor;
- clears active origin and migration lineage;
- cancels same-epoch conflicts/recovery;
- installs null.

Then ACK, generation-fenced checkpoint cleanup, and duplicate commit.

## Re-ACK and holder gossip

A resent original end matching a retained certificate re-ACKs before disposition checks. Holders send fresh end gossip containing the certificate; receiver merges ended disposition and certificate atomically. Retirement gossip with reason ended is rejected.

## Dispositions

- ended: terminal only with exact certificate;
- switched: historical evidence references one retained epoch transition;
- reconciled: informational/nonterminal at active high water;
- below-high-water subject: rejected locally but answered with current supersession evidence.

Historical dispositions/certificates may compact under their bounds, but epoch transitions are retained. Therefore stale-peer convergence never depends on retaining the exact disposition.

## Supersession responses

For any authenticated stale subject:

- active current outcome → contiguous transition chain, current origin, and exact-floor state if available;
- ended current outcome → chain plus current completed-end certificate;
- floor-only holder → chain plus current outcome/origin and recovery targets;
- no exact old disposition required.

## Capacity failure

Operational metadata always reserves space for the compact capacity lock. If an end certificate, transition, lineage record, or current evidence cannot fit:

1. abort the evidence mutation;
2. atomically persist capacity lock in reserved headroom;
3. disable all novella installs/controls;
4. allow only higher-epoch safety recovery or explicit reset;
5. retain chat/media/files.

## Tests

- dropped ACK + reload + resend;
- ended without certificate never terminal;
- certificate binding/tampering;
- A→B→C and A→B→B-ended supersession;
- stale peer after disposition trimming and missed lifecycle event;
- current end/higher epoch dominance;
- byte/certificate overflow still persists durable lock.
