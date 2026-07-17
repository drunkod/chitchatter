# 13 — Coherent bootstrap, proof-recovery UI, and room integration

> **Revision 13 changes:** distinguishes proof assembly from full-state recovery, exposes reset-only versus remotely recoverable capacity locks, and uses immutable checkpoint records.

## Keyed provider

```tsx
export const VisualNovelProvider = (props: Props) => (
  <VisualNovelBootstrap key={props.roomId} {...props} />
)
```

Room navigation immediately unmounts the old receiver, proof assemblies, audio, and store subscription.

## Coherent bootstrap

1. derive room scope;
2. establish generation notification buffer;
3. acquire room Web Lock;
4. read emergency marker, RoomMeta, latest pointer, and immutable checkpoint record;
5. validate transition chain, current outcome dominance, pointer/record identity, and checkpoint classification;
6. initialize canonical store or read-only recovery;
7. subscribe and re-read latest generation;
8. retry whole bootstrap if generation changed;
9. attach receiver only after stable result.

## Recovery phases

Add distinct phases:

- `recovering-proof`: assembling transition pages; no metadata/state change yet;
- `recovering-state`: proof/floor accepted, exact current full state missing;
- `safety-recovery`: recoverable capacity proof in progress;
- `safety-reset-required`: transition-limit or digest-collision;
- existing bootstrap/lobby/starting/syncing/ready/waiting/reconciling/ending/error phases.

## Canonical store

```tsx
const state = useSyncExternalStore(
  canonicalStore.subscribe,
  canonicalStore.getSnapshot,
  canonicalStore.getServerSnapshot,
)
```

React does not mirror metadata evidence in independent mutable refs.

## User messages

- proof assembly: “Receiving the room’s novella history…”
- state recovery: “History verified. Recovering the latest novella state…”
- ended supersession: “This novella was replaced and the current novella has ended.”
- recoverable capacity: “Novella safety storage is full. A newer room epoch may repair it.”
- transition limit: “The retained novella history reached its protocol limit. Reset is required.”
- digest collision: “A protocol digest conflict was detected. Reset after an update is required.”
- capability error: “This browser cannot provide the required cross-tab lock.”

Progress indicators show page count only after a validated manifest. Do not imply a page has changed canonical room state.

## Freshness and actions

Every novella button invokes a service command that first refreshes metadata generation. Stale tabs cancel action and enter the appropriate recovery phase.

## Room integration

Chat, voice, video, screen share, and files remain mounted during every novella recovery/safety phase. Direct-message rooms mount no novella provider. Keep real `RoomVideoDisplay userId width height` props and transport identity from `peerRoom.getSelfId()`.
