# 08 — Sync gate, proof assembly, safety recovery, and conflict rebasing

> **Revision 13 changes:** validates outcome dominance rather than transition equality, assembles paginated proofs before mutation, and applies cause-specific capacity recovery.

## Gate decisions

```ts
type GateDecision =
  | { kind: 'dispatch' }
  | { kind: 'drop'; reason: string }
  | { kind: 'reack-end' }
  | { kind: 'reply-ended'; certificate: CompletedEndCertificate }
  | { kind: 'reply-disposed'; disposition: SessionDisposition }
  | { kind: 'reply-superseded'; requestActionId: string }
  | { kind: 'reply-floor'; outcome: EpochOutcome; origin: SessionOriginEvidence | null }
  | { kind: 'collect-proof-page' }
```

## Gate order

After normalization and outer identity:

1. resent original end matching retained certificate → re-ACK;
2. duplicate non-page action handling;
3. proof pages matching an outstanding supersession/safety recovery → bounded assembly path;
4. exact current ended/switched evidence replies;
5. authenticated subject below high water → start paginated supersession response;
6. active-epoch reconciled informational response while complete evidence proceeds;
7. ended high-water install path → drop;
8. durable/runtime lock → reject ordinary install/request mutation;
9. dispatch.

Proof pages are duplicate-aware by `(proofId, pageIndex, pageDigest)`, not ordinary action-ID suppression.

## Proof assembly

A `ProofAssembly` is created only for an exact outstanding request and target. Collection:

- validates each page independently;
- enforces page count, page bytes, total assembly bytes, expiry, and source;
- stores identical duplicate pages idempotently;
- rejects unequal duplicate indexes;
- never mutates metadata/state.

On completion:

1. concatenate and validate the full transition chain;
2. validate current evidence identity and floor dominance;
3. re-read latest metadata under the room lock;
4. discard if local high water already dominates;
5. supersession purpose: merge missing transitions/evidence, raise high water, enter ended or floor-only active state;
6. safety purpose: apply the lock-code policy and fit preflight before clearing lock;
7. commit duplicate/proof completion only after transaction success.

## Supersession response generation

Holder constructs compact pages beginning after the requested epoch. Current outcome evidence is included only in the final page. The proof never includes a full current state, so page serialization remains bounded independently of snapshot size.

## Capacity recovery

Only these lock codes may request remote recovery:

- `evidence-limit`;
- `lineage-limit`;
- `operational-bytes`.

Recovery requires a complete proof ending strictly above `lockedAtEpoch`. Inside one lock:

- compact permitted historical dispositions/certificates first;
- verify incoming transitions keep count within `maxEpochTransitions`;
- verify final metadata fits `maxOperationalRoomMetaBytes`;
- clear old lineage/conflicts/recoveries as the higher epoch supersedes them;
- clear lock and adopt final outcome/origin atomically;
- enter floor-only active recovery or ended state.

`transition-limit` and `digest-collision` reject both safety request and gossip and require explicit reset according to policy.

## Conflict rebase

For `SESSION_RECONCILE`:

- validate state/descriptor and require `originTransition` for a different-session incoming state;
- compare inside transaction against latest complete baseline and floor;
- exact other digest → exact path;
- changed baseline → rebase;
- incoming winner → fresh descriptor and atomic apply; a different-session winner replaces the active high-water transition slot and canonical predecessor switched evidence;
- incoming loser with complete local winner → return winner/fresh descriptor;
- incoming loser while floor-only → return floor gossip and recover canonical state;
- equal digest → idempotent subject to collision checks.

## Transaction API

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

## Authorization summary

| Action | Authority |
| --- | --- |
| start proposal/commit | coordinator, exact new epoch, valid compact transition/origin |
| reconcile | exact/rebased descriptor; full compact origin transition on session change |
| snapshot | current controller or exact recovery target |
| floor gossip | current outcome/floor evidence; noninstalling |
| progression | current controller, exact session/revision, fresh generation |
| session started | predecessor controller; exact next epoch |
| end/ACK/gossip | exact controller/action/certificate |
| supersession page | holder identity; exact request and proof chain |
| safety page | recoverable capacity code; exact request and higher proof |
| election advertise/change | selected migration round and valid transcript |
