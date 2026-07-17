# 11 — Termination ACKs, completed certificates, and session dispositions

> **Revision 10 changes:** ending cancels every same-epoch install path, retirement uses structured holder gossip, and active-epoch reconciled dispositions remain nonterminal evidence.

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

Replica verifies controller, exact next revision, story identity, and payload epoch. One lock-scoped transaction:

- adds/updates `SessionDisposition(reason: 'ended')`;
- stores exact `CompletedEndCertificate`;
- if exact canonical outcome, marks it `ended` while preserving final floor;
- clears active decision and migration lineage;
- cancels same-epoch conflicts and outstanding recovery records;
- installs null canonical state.

Then it sends ACK, clears the checkpoint best-effort, and commits the action ID.

## Re-ACK after reload

Before duplicate/disposition checks, compare an incoming original end action ID with retained certificates. Exact match returns `reack-end` even if in-memory duplicate history was lost.

## Holder gossip

A holder sends a fresh bootstrap-scoped `SESSION_END_NOTICE_GOSSIP` containing the normalized certificate. Outer sender matches transport context. The original event binds action ID, session, epoch, story ID/version, revision, and controller sender.

## Dominance

- current higher epoch: retain evidence; never clear higher state;
- current exact session/epoch/story: transactionally persist evidence, end matching outcome if canonical, cancel recovery/conflicts, install null;
- same epoch different session: retain exact ended evidence, but do not clear other canonical state;
- current null: persist idempotently;
- already retained exact certificate: no-op.

An ended canonical outcome rejects every same-epoch state-install path, not only start decisions.

## Dispositions

- `ended`: terminal only with a matching certificate;
- `switched`: terminal for the exact session;
- `reconciled`: nonterminal while its epoch remains active; used for checkpoint cleanup and UI history;
- any disposition below high water is terminal because the epoch is superseded.

## Structured retirement gossip

A holder responds to stale switched/reconciled traffic with:

```ts
SESSION_RETIREMENT_GOSSIP { disposition }
```

The receiver validates and persists the exact record. A reconciled notice does not terminally block later complete-state evidence. An `ended` disposition without a matching certificate is retained as non-authoritative warning only and cannot close state.

## Bounds

Never trim current-high-water dispositions or certificates. If current-epoch bounds are exhausted, reject the new mutation safely. Historical records below high water may be trimmed in coordinated order.

## Tests

- dropped ACK + reload + original resend re-ACKs;
- certificate epoch/story/action tampering rejects;
- end cancels pending same-epoch snapshots/reconciliation;
- holder with changed peer ID forwards certificate/disposition;
- reconciled notice does not block later stronger state;
- switched notice remains terminal;
- exact migrated/progressed session ends, other session/higher epoch does not;
- current-epoch bound exhaustion fails closed.
