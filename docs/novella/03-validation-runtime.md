# 03 — Runtime structural validation and normalization

> **Revision 9 changes:** validates end epoch/story binding, separate retirement/certificate records, epoch outcomes, and session-bound migration rules.

## Envelope order

1. reject over-budget encoded input;
2. validate protocol/action/primitive fields;
3. validate and normalize the selected payload;
4. cross-check outer scope against embedded content;
5. drop unknown fields and MVP `proof`;
6. run semantic validation separately.

All returned values are fresh objects.

## Start and reconciliation

- start decisions require revision 0 and a recomputed deterministic decision ID;
- `START_COMMITTED` coordinator equals outer sender;
- start gossip holder may differ from embedded coordinator;
- known state shares decision session/epoch and is revision >= 0;
- `SESSION_RECONCILE.conflictId` is bounded;
- when reconciliation changes session ID, a matching revision-0 `decision` is mandatory and must describe that state’s session/epoch;
- same-session migration reconciliation may omit the decision.

## Completed-end binding

```ts
const validateCompletedEndCertificate = (
  input: unknown,
): ValidationResult<CompletedEndCertificate> => {
  const end = validateEnvelope(input.endEnvelope)
  if (!end.ok || end.value.actionType !== 'SESSION_ENDED') {
    return fail('Invalid completed-end envelope')
  }
  if (
    end.value.sessionId !== input.sessionId ||
    end.value.storyId !== input.storyId ||
    end.value.storyVersion !== input.storyVersion ||
    end.value.payload.sessionEpoch !== input.sessionEpoch
  ) {
    return fail('Completed-end certificate binding mismatch')
  }
  return normalizedCertificate(...)
}
```

The original `SESSION_ENDED` outer scope is the live session and its payload epoch equals that session state’s epoch. `SESSION_END_NOTICE_GOSSIP` uses bootstrap outer scope/revision 0 and identifies only the holder.

## Retirement and migration

- retirement reason is exactly `ended`, `switched`, or `reconciled`;
- migration ID binds `sessionEpoch`, `sessionId`, and departed controller;
- migration last state, when present, shares session/epoch;
- `CONTROLLER_CHANGED.state.sessionId` must equal the active migration session;
- cross-session controller-change announcements are structurally valid envelopes but fail protocol authorization in 10.

## RoomMeta normalization

Validate byte/count limits, safe generation/high water, and all nested records. Then reject:

- high water 0 with any outcome/active record;
- non-zero high water without matching outcome;
- outcome epoch different from high water;
- ended outcome with active start/migration;
- active decision different from active outcome;
- active migration different from active outcome;
- active migration last-state mismatch;
- active outcome session retired while status is active;
- duplicate or non-canonically ordered retirements/certificates;
- certificate without matching ended retirement;
- ended retirement whose certificate fields disagree, when a certificate is present;
- active records for different sessions;
- certificate epoch/story/session mismatch with original end envelope.

A switched/reconciled retirement needs no certificate. Malformed existing metadata blocks receiver attachment.

## Required tests

- alias-free normalization for every payload/record;
- decision, conflict, migration, election, and certificate binding;
- certificate epoch/story tampering;
- every RoomMeta contradiction;
- switched/reconciled retirement without end envelope is accepted;
- ended certificate requires exact matching retirement.
