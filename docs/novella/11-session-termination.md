# 11 — Session termination, acknowledgements, and completed-end gossip

> **Revision 8 changes:** retained end certificates are forwarded in identity-safe outer envelopes and explicitly dominate same-session/same-epoch migration or progression.

## Controller ACK round

The controller creates one `SESSION_ENDED` at exact next revision, freezes current recipients, keeps state/authority, resends the same action ID to unacknowledged recipients, and finalizes only after every frozen recipient ACKs or leaves.

On finalization, one serialized metadata mutation stores the exact `PersistedEndNotice`, raises high water if needed, and clears matching active start/migration records. Only after that succeeds does the controller clear state/checkpoint.

If persistence fails, termination remains pending/read-only and retries.

## Applying the original end

A replica accepts the original `SESSION_ENDED` only from its current controller at exact next revision. It then:

1. persists the tombstone/certificate;
2. sends `SESSION_END_ACK` to the original sender;
3. clears matching state/checkpoint;
4. commits the action ID.

Duplicate original end is checked before tombstones and triggers another ACK.

## Identity-safe retained certificate

A holder responding to stale traffic sends:

```ts
makeEnvelope(
  'SESSION_END_NOTICE_GOSSIP',
  { ended: sync.getRetainedEndNotice(sessionId)! },
  bootstrapScope,
  0,
)
```

The outer sender is the holder and must match transport context. The embedded original envelope remains evidence of the controller-issued end under the honest-peer MVP model.

## Dominance semantics

After structural and certificate validation:

- current higher epoch: retain/drop certificate as stale; never clear the higher session;
- current same epoch and same session ID: certificate wins regardless of migrated controller or later revision, persist tombstone, enter `reconciling`, clear state/checkpoint, show that the room completed an end that this peer missed;
- current same epoch but different session ID: retain the tombstone for its exact session but do not clear the other timeline;
- current null: persist idempotently;
- certificate for an already retained exact `(sessionId, epoch, original actionId)` is a no-op.

This closes controller-crash-during-termination splits. It intentionally may roll back post-migration novella actions for the ended session. A malicious peer could fabricate such a certificate only by fabricating a structurally valid original controller envelope; signatures are post-MVP hardening.

## Gate responses

Tombstoned `STATE_REQUEST`, advance, choice, restart, and same-session confusion receive a fresh `SESSION_END_NOTICE_GOSSIP`, never the original end envelope. Other tombstoned traffic drops.

## Participation

Participation remains sync-ref owned. Leave is scoped to one session; a higher epoch resets it. Rejoin sets `joined` before exact-target bootstrap send.

## Tests

- send resolves before delivery but no finalize without ACK;
- first ACK dropped, duplicate original end re-ACKs;
- holder with a different peer ID successfully forwards certificate;
- certificate ends a migrated/progressed same session and shows rollback-to-lobby;
- certificate never ends another session or higher epoch;
- persistence failure retains old interactive state/termination round;
- full reload retains and forwards certificate.
