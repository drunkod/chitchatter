# 11 — Termination ACKs, completed certificates, dispositions, and successor notices

> **Revision 11 changes:** ended terminality now requires a certificate, retirement gossip forbids standalone ended records, switched notices carry successor evidence, and disposition merging is deterministic.

## Original end and ACK round

Controller creates one exact-next-revision event with `{ sessionEpoch }`, freezes recipients, retains state/authority, resends the same action ID, and finalizes only after every frozen recipient ACKs or leaves.

## First application

Replica verifies current controller, exact next revision, story identity, and payload epoch. One transaction:

- upserts ended disposition keyed by `(epoch, session, ended)` with `evidenceId = endActionId`;
- stores exact completed certificate;
- marks exact canonical outcome ended while preserving final floor;
- clears active origin and migration lineage;
- cancels same-epoch conflicts/recovery;
- installs null canonical state.

Then ACK, checkpoint cleanup best-effort, and duplicate commit.

## Re-ACK after reload

Before duplicate/disposition checks, match incoming original end action ID against retained certificates. Exact match re-ACKs even after in-memory duplicate history was lost.

## Completed-end holder gossip

A holder sends fresh `SESSION_END_NOTICE_GOSSIP`. Receiver validates outer holder identity and embedded original event. Certificate and ended disposition merge atomically. `SESSION_RETIREMENT_GOSSIP` with reason `ended` is rejected.

## Terminality

- ended: terminal only with exact matching certificate;
- switched: valid persisted record is historical below high water because successor evidence raised the room;
- reconciled: nonterminal at active high water;
- any record below high water: terminal by epoch supersession.

An unverified “ended” warning may be logged transiently but never enters authoritative RoomMeta or gate suppression.

## Disposition gossip

### Reconciled

May carry `successor: null` as informational history. It does not clear state or block complete evidence. If successor is included, it must describe current outcome and may accelerate recovery.

### Switched

Must carry successor outcome/origin and optional exact-floor known state. Receiver transaction:

1. validates disposition and successor origin;
2. requires successor epoch greater than disposed epoch;
3. raises high water/outcome/origin as authorized;
4. merges switched disposition;
5. installs known state only when digest exactly equals floor, otherwise enters floor-only recovery;
6. clears obsolete lineage/conflicts/recovery.

A standalone switched disposition cannot contradict a stale active outcome because it is never persisted alone.

## Deterministic merge

- logical key `(epoch, sessionId, reason)`;
- ended/switched duplicate with same evidence ID is idempotent;
- ended/switched different evidence ID is blocking contradiction;
- reconciled duplicate chooses bytewise-minimum conflict ID as informational evidence;
- record order is canonical by epoch/session/reason/evidence ID.

## Capacity failure

Current-epoch disposition/certificate overflow sets capacity safety lock in the same failed operation. The room disables all novella mutation/installation. It does not continue interactively after refusing end evidence. Verified higher epoch or explicit reset may recover according to policy.

## Tests

- dropped ACK + reload + resend re-ACKs;
- ended disposition without certificate never terminal/persisted;
- end-certificate binding/tampering;
- switched notice before successor data merges coherently;
- switched notice without successor rejects;
- reconciled notice permits later stronger state;
- deterministic duplicate merge under reorder;
- exact migrated/progressed session ends only itself;
- capacity overflow enters room-wide safety lock.
