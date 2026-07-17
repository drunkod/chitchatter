# 12 — Sync runtime, proof assembly, dispatch, refresh, and safety recovery

> **Revision 13 changes:** adds bounded page assemblies, separates proof adoption from snapshot recovery, and dispatches transcript-derived controller changes.

## Ready inputs

```ts
interface Options {
  transport: VisualNovelTransport
  bootstrap: ConsistentBootstrapSnapshot
  metaStateTransaction: MetaStateTransaction
  storyCatalog: StoryCatalog
  canonicalStore: CanonicalVisualNovelStore
  onProtocolError: (message: string) => void
}
```

No installing receiver exists before emergency-state check, coherent bootstrap, transition validation, story resolution, floor, and strongest baseline.

## Receive path

```text
normalize → outer identity → proof-page/pre-gate handling
→ participation → semantic validation/JCS digest
→ authorization or rebase/derive
→ room-lock metadata/store transaction
→ duplicate commit → immutable checkpoint side effect
```

Dispatch is exhaustive for all 26 actions.

## Proof assemblies

Runtime maintains at most `maxProofAssemblies`. Each assembly binds:

- proof ID and purpose;
- request action ID;
- exact source peer;
- manifest and holder source generation;
- page map/encoded bytes;
- expiry;
- starting local generation/high water.

Page delivery:

- reorder allowed;
- identical duplicate allowed;
- unequal duplicate rejected;
- mixed sender/manifest rejected;
- expiry removes assembly and retries missing proof;
- generation or high-water advance invalidates obsolete assembly.

Only complete proof enters a metadata transaction. Pages never partially raise high water.

## Supersession completion

After a valid complete proof:

- if local high water is already newer, discard;
- merge missing compact transitions;
- adopt final current outcome and active origin/end state;
- install null canonical state;
- if active, enter floor-only recovery and issue exact `STATE_REQUEST`;
- install full state only through later authorized `STATE_SNAPSHOT`.

## Safety recovery completion

Only an outstanding request for a recoverable capacity code can assemble safety pages. Complete proof then undergoes lock-code, transition-count, compaction, and operational-byte preflight. Clearing lock and adopting the higher outcome happen atomically.

## Migration dispatch

`ELECTION_ADVERTISE` stores/updates bounded runtime advertisements for its shared round. `CONTROLLER_CHANGED` validates transcript and winning state, derives the post-change state locally, and routes it through normal comparison/rebase/install logic.

## Recovery map

Records bind target, request, kind, epoch/session, expected floor, conflict/migration identity, and expiry.

- changed floor → rebase;
- floor-only winner → floor gossip and canonical recovery;
- ended/higher epoch → cancel matching records;
- durable capacity lock → only allowed safety request/assembly remains active;
- runtime lock/storage failure → no network install recovery.

## External generation repair

Call `ensureLatestGeneration()` on metadata notifications, focus, visibility, before every state-changing command/send, and before start/migration rounds. Advanced generation triggers recovery, ended, or safety phase.

## Checkpoint publication

After transaction success, publish an immutable checkpoint record keyed by session/generation/floor digest. Under lock, publish the pointer only when token generation, outcome subject, and floor digest still match.

## Cleanup

Cancel timers, recoveries, proof assemblies, advertisement collections, focus listeners, generation subscriptions, and store subscriptions. Room-key change unmounts old runtime first.
