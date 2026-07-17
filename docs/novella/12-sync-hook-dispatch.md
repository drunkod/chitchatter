# 12 — Sync runtime, dispatch, refresh, and safety recovery

> **Revision 12 changes:** adds dedicated supersession/floor/safety-recovery dispatch, generation-fenced checkpoints, and explicit local versus durable lock handling.

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

No installing receiver exists before emergency-lock check, coherent bootstrap classification, transition validation, stories, floor, and strongest baseline are ready.

## Receive path

```text
normalize → identity → pre-gate safety recovery/supersession gate
→ participation → semantic validation/JCS digest
→ authorization or rebase → room-lock transaction
→ duplicate commit → generation-fenced checkpoint side effect
```

Dispatch is exhaustive for all actions, including `STATE_FLOOR_GOSSIP`, `SESSION_SUPERSESSION_GOSSIP`, and both safety-recovery actions.

## Recovery map

Records bind target, request ID, kind, epoch/session, expected floor digest, conflict/migration identity, and expiry. Response processing re-reads latest metadata.

- changed floor → exact rebase;
- floor-only winner → floor gossip and canonical recovery;
- ended/higher epoch → cancel matching records;
- capacity lock → only safety-recovery record remains active;
- runtime capability/storage failure → no network install recovery.

## Stale-peer response priority

1. exact completed-end certificate when current subject ended;
2. generic supersession evidence for any subject below high water;
3. active-epoch reconciled history plus complete/floor evidence;
4. pending end;
5. current transition origin/start decision;
6. snapshot/progression response.

No stale authenticated request is silently dropped merely because historical disposition history was compacted.

## External generation repair

Call `ensureLatestGeneration()` on notifications, focus, visibility, before every state-changing UI action/send, and before start/migration rounds. Advanced generation triggers null/recovery/safety phase as appropriate.

## Lock handling

- durable capacity/digest locks come from RoomMeta;
- lock-unavailable/storage-failure are runtime states;
- generic gate rejects installs while locked;
- capacity recovery gossip is processed by the dedicated pre-gate path;
- capability reprobe or storage repair performs a fresh coherent bootstrap before re-enabling receiver.

## Checkpoint publication

After transaction success, call `publishCheckpoint(token, state)`. The service writes the session blob, then under the room lock rechecks generation, outcome session, and floor digest before replacing the latest pointer. Stale tokens leave the blob unreferenced and cannot overwrite a newer pointer.

## Cleanup

Cancel timers, recoveries, safety requests, focus listeners, generation subscriptions, and store subscriptions. Room-key change unmounts the old runtime before the new bootstrap.
