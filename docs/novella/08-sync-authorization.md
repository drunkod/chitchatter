# 08 — Sync gate, supersession, safety recovery, and conflict rebasing

> **Revision 12 changes:** replaces below-high-water drops with supersession replies, adds a pre-gate capacity-recovery path, defines floor-only conflict responses, and binds election advertisements to lineage.

## Gate decisions

```ts
type GateDecision =
  | { kind: 'dispatch' }
  | { kind: 'drop'; reason: string }
  | { kind: 'reack-end' }
  | { kind: 'reply-ended'; certificate: CompletedEndCertificate }
  | { kind: 'reply-disposed'; disposition: SessionDisposition }
  | { kind: 'reply-superseded'; evidence: SupersessionEvidence }
  | { kind: 'reply-floor'; outcome: EpochOutcome; origin: SessionOriginEvidence | null }
  | { kind: 'safety-recovery' }
```

## Gate order

After normalization and outer identity:

1. exact resent original end matching a retained certificate → re-ACK;
2. duplicate handling;
3. `SAFETY_RECOVERY_GOSSIP` against a durable capacity lock → dedicated pre-gate verification;
4. exact completed end/switched evidence replies;
5. any authenticated subject epoch below high water → `reply-superseded` using retained transition chain/current evidence;
6. active-epoch reconciled confusion may receive informational disposition while complete evidence proceeds;
7. ended high-water install path → drop;
8. remaining durable/runtime safety lock → reject install/request mutation;
9. dispatch.

Historical-disposition trimming never changes step 5 because transition certificates, outcome, origin/end evidence are separate durable records.

## Transaction/bootstrap API

```ts
interface MetaStateTransaction {
  transactAndInstall<T>(
    change: (current: RoomMeta) => { meta: RoomMeta; value: T },
    install: (value: T, token: AppliedGenerationToken) => void,
  ): Promise<AppliedGenerationToken>

  mutate(change: (current: RoomMeta) => RoomMeta): Promise<RoomMeta>
  readConsistentBootstrap(roomScope: string): Promise<ConsistentBootstrapSnapshot>
  ensureLatestGeneration(): Promise<RoomMeta>
  publishCheckpoint(token: AppliedGenerationToken, state: ValidatedState): Promise<void>
  subscribe(listener: (meta: RoomMeta) => void): () => void
}
```

All critical methods require the room Web Lock.

## Conflict rebase

For `SESSION_RECONCILE`:

- validate incoming state/origin/descriptor and optional migration ID;
- compare inside the transaction against latest complete state and floor;
- exact other digest → exact path;
- changed baseline → rebase;
- incoming wins → fresh descriptor and atomic apply;
- incoming loses with complete local winner → return winner plus fresh descriptor;
- incoming loses while floor-only → return `STATE_FLOOR_GOSSIP`, initiate canonical-state recovery, and do not invent a complete winner;
- equal digest → idempotent only after collision check where both bytes exist.

## Safety recovery

Only durable `capacity` lock accepts remote recovery:

1. requester sends `SAFETY_RECOVERY_REQUEST` without enabling other outgoing state requests;
2. holder sends `SAFETY_RECOVERY_GOSSIP` containing a transition chain whose final epoch is strictly greater than `lockedAtEpoch`;
3. pre-gate validator checks chain, current outcome/origin/end evidence, known state, and byte limits;
4. one room-lock transaction rechecks the lock, merges transitions/evidence, clears capacity lock, advances high water, and installs exact state or floor-only recovery;
5. same/lower epoch never clears the lock.

Digest-collision locks require reset/protocol upgrade. Lock-unavailable and storage-failure are local capability states and never clear from network input.

## Authorization summary

| Action | Authority |
| --- | --- |
| start proposal/commit | coordinator, next epoch, valid transition/origin |
| reconcile | valid exact/rebased descriptor; origin on session change |
| snapshot | current controller or exact recovery target; floor/closed checks |
| floor gossip | current outcome/floor evidence; noninstalling |
| progression | current controller, exact revision/session, fresh generation |
| session started | predecessor controller; exact next epoch; full transition certificate |
| end/ACK/gossip | exact controller/action/certificate rules |
| supersession | holder identity; contiguous retained transition chain |
| safety recovery | capacity lock only; strictly higher verified chain |
| election advertise/change | selected retained migration record and bound round fields |
