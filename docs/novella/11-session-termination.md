# 11 — Termination ACKs, completed certificates, and retirement

> **Revision 9 changes:** original end payload binds epoch, re-ACK survives reload through retained action-ID matching, and retirement is separate from certificate evidence.

## Original end and ACK round

Controller creates one exact-next-revision event:

```ts
createEnvelope(
  'SESSION_ENDED',
  { sessionEpoch: current.sessionEpoch },
  current,
  current.revision + 1,
)
```

It freezes recipients, retains authority/state, resends the same action ID, and finalizes only after every recipient ACKs or leaves.

## First application

Replica verifies current controller, exact next revision, and payload epoch. One locked mutation:

- add/update `SessionRetirement(reason: 'ended')`;
- add exact `CompletedEndCertificate`;
- if this is the active outcome’s canonical session, set outcome status `ended`;
- clear matching active decision/migration.

Then send ACK, clear matching state/checkpoint, and commit action ID.

## Re-ACK after reload

Before duplicate/tombstone checks, compare incoming original `SESSION_ENDED.actionId` with retained certificates. Exact match returns `reack-end` even when the in-memory seen-action set was lost on reload.

## Holder gossip

A holder sends a fresh bootstrap-scoped `SESSION_END_NOTICE_GOSSIP` containing the normalized certificate. The outer sender matches transport context; the embedded original event binds session ID, epoch, story ID/version, and original controller action ID.

## Dominance

- current higher epoch: retain certificate; do not clear higher state;
- current exact session/epoch/story: persist idempotently, enter reconciliation, clear state/checkpoint;
- current same epoch but different session: retain exact retirement/certificate only; do not clear the other timeline;
- current null: persist idempotently;
- already retained exact certificate: no-op.

If the certificate ends the canonical high-water outcome, mark the epoch ended so other same-epoch decisions cannot resurrect.

## Switch/reconciliation retirement

`switched` and `reconciled` retirements suppress stale exact-session traffic but have no completed certificate. Replies use `SESSION_RETIRED`, not end gossip.

## Tests

- dropped ACK + recipient reload + original resend re-ACKs;
- certificate epoch/story tampering rejects;
- holder with changed peer ID forwards successfully;
- exact migrated/progressed session ends, other session/higher epoch does not;
- switched/reconciled retirement works without certificate;
- canonical end blocks losing decision resurrection.
