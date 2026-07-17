# 08 — Sync service, typed gate, lock-scoped transactions, and authorization

> **Revision 10 changes:** centralizes closed-epoch checks for every state install, permits nonterminal reconciled evidence, adds generation-safe `transactAndInstall`, and authorizes symmetric first-contact reconciliation.

## Gate decisions

```ts
type GateDecision =
  | { kind: 'dispatch' }
  | { kind: 'drop'; reason: string }
  | { kind: 'reack-end' }
  | { kind: 'reply-ended'; certificate: CompletedEndCertificate }
  | { kind: 'reply-disposed'; disposition: SessionDisposition }
```

Order after normalization and outer identity:

1. original `SESSION_ENDED` whose action ID matches a retained certificate → `reack-end`;
2. duplicate original end → `reack-end`;
3. duplicate other action → drop;
4. exact terminal disposition:
   - ended with certificate and request/confusion traffic → `reply-ended`;
   - switched or older-epoch disposition → `reply-disposed`;
   - otherwise drop;
5. active-epoch `reconciled` disposition:
   - request/progression confusion → `reply-disposed`;
   - complete-state evidence (`START_*`, `SESSION_RECONCILE`, solicited `STATE_SNAPSHOT`, migration actions) continues to authorization;
6. proposal at `<= highWater` → drop;
7. decision/gossip at `< highWater` → drop;
8. any state-installing action at an ended high-water epoch → drop;
9. other state traffic below high water → drop;
10. dispatch.

`reply-disposed` sends `SESSION_RETIREMENT_GOSSIP` with the exact normalized disposition.

## State-installing action set

The central closed-epoch guard covers:

- `START_COMMITTED`, `START_DECISION_GOSSIP`;
- `SESSION_RECONCILE`;
- `STATE_SNAPSHOT`;
- `SESSION_STARTED`;
- `RESTARTED`;
- `CONTROLLER_CHANGED`;
- normal progression events that produce/install state.

It runs in the gate when possible, in action authorization, and inside the locked mutation.

## Lock-scoped transaction API

```ts
interface MetaStateTransaction {
  transactAndInstall<T>(
    change: (current: RoomMeta) => { meta: RoomMeta; value: T },
    install: (value: T, token: AppliedGenerationToken) => void,
  ): Promise<AppliedGenerationToken>

  mutate(change: (current: RoomMeta) => RoomMeta): Promise<RoomMeta>
  readLatest(): Promise<RoomMeta>
  subscribe(listener: (meta: RoomMeta) => void): () => void
}
```

`transactAndInstall` obtains the room Web Lock, reads latest RoomMeta, applies and validates the mutation, increments generation, writes, updates the sync service’s canonical state store synchronously through a no-throw `install`, then releases the lock. React subscribes to that store. Checkpoint cleanup happens afterward.

No handler performs `await metadataWrite(); setState(...)`.

External-generation notifications queue behind local transactions. If newer metadata changes outcome/floor, the service enters read-only reconciliation and exact recovery; it never allows a stale deferred install.

## Recovery authorization

Records are keyed by request action ID. Every kind requires exact sender/target, unexpired record, epoch/session, and success-time deletion.

- `revision-gap`: exact active session, state not below floor/current baseline;
- `bootstrap`: compare to floor and strongest boot state; exact canonical session unless authorized start reconciliation;
- `start-reconcile`: symmetric descriptor verifies against current baseline; different session requires decision;
- `migration-reconcile`: descriptor migration ID is in lineage; incoming same session/story and wins current/floor baseline.

When an outcome becomes ended, cancel all matching same-epoch recovery and conflict records before any later response can apply.

## Authorization summary

| Action | Authority |
| --- | --- |
| start proposal | proposer owns candidate; local coordinator; next epoch |
| start commit/gossip | valid decision; outcome active/not closed; compare against floor and strongest state |
| reconciliation | self-verifying descriptor; complete state wins; story identity rules |
| snapshot | current controller or exact recovery target; central closed-epoch/floor checks |
| requests/progression | current controller; exact session/revision; no pending termination |
| switch | current controller; exact next epoch; terminally dispose old |
| original end | current controller; exact next revision; payload epoch matches |
| end ACK | frozen recipient and exact end action |
| end gossip | holder identity; exact certificate dominance |
| retirement gossip | holder identity; exact normalized disposition |
| controller change | selected retained migration ID; same session/story; strongest floor/current baseline |
| control actions | reject until implemented |
