# 15 — Locked RoomMeta, retirement, certificates, and checkpoints

> **Revision 9 changes:** mutation functions execute inside the lock against latest storage, final generation is validated, retirement is separate from certificates, and epoch outcome closes ended epochs.

## Keys

```text
visual-novel:v1:<roomScope>:meta
visual-novel:v1:<roomScope>:latest
visual-novel:v1:<roomScope>:<sessionId>
```

Room scope is a one-way digest of effective room identity. Never store room secret, invite URL, crypto key, chat, or media.

## Bootstrap

1. derive room scope;
2. load/normalize RoomMeta;
3. load latest pointer/checkpoint;
4. structurally and semantically validate checkpoint and active states;
5. reject retired checkpoint;
6. enforce outcome/active-record consistency;
7. compute strongest boot baseline;
8. mount ready runtime, then receiver.

## Mutation contract

```ts
metaAdapter.mutate(change)
```

The adapter obtains a room-scoped Web Lock, reads and validates latest stored metadata, applies `change` inside the lock, increments generation, validates the exact final object, writes it, and publishes the new generation. A local promise queue orders calls. BroadcastChannel/storage notifications refresh other same-room tabs.

Protocol mutations repeat authorization preconditions inside `change(current)`. A stale runtime cannot overwrite a newer outcome, retirement, certificate, decision, or migration.

If lock semantics or critical writes fail, novella becomes read-only and exposes no new canonical state. Checkpoints remain best-effort continuity only.

## Protocol mutations

- start winner: raise high water; set active outcome/decision; retire losing different session;
- start same-session reconciliation: preserve session identity and update canonical baseline;
- open migration: require active outcome/session and store session-bound record;
- migration winner: compare with strongest current/recorded state and update last state;
- switch: retire old as switched; create next active outcome; clear old records;
- completed end: retire ended; store certificate; mark matching canonical outcome ended; clear matching active records;
- reconciliation replacement: retire losing different session; update outcome/decision; clear/reopen migration as required;
- reset: explicit confirmation only.

## Bounds and trimming

Retirements and certificates are canonically sorted and separately bounded. Trimming is coordinated: every retained certificate keeps its matching `ended` retirement, and certificate trimming happens before any now-unreferenced retirement is removed. Keep newest entries by `(sessionEpoch, sessionId)`. Old epochs remain suppressed by high water even after trimming. The current epoch outcome is never trimmed.

## Checkpoints

Write truncated canonical checkpoint and latest pointer after state exposure. Clear losing, switched, reconciled, or ended checkpoints. A provisional checkpoint grants no authority.

## Tests

- concurrent tabs preserve union of records;
- mutation executes against latest stored data inside lock;
- generation overflow/final validation blocks write;
- separate retirement/certificate round trip;
- strongest boot baseline chooses progressed checkpoint;
- ended outcome blocks same-epoch resurrection.
