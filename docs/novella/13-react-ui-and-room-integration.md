# 13 — Coherent bootstrap, canonical-store UI, and safety states

> **Revision 12 changes:** bootstrap reads durable emergency/safety state first, exposes supersession and floor-only recovery, and follows the explicit lock recovery matrix.

## Keyed provider

```tsx
export const VisualNovelProvider = (props: Props) => (
  <VisualNovelBootstrap key={props.roomId} {...props} />
)
```

Room navigation immediately removes old receiver and subscriptions.

## Bootstrap

1. derive room scope;
2. probe required Web Lock/storage capability;
3. establish generation notification buffer;
4. read durable safety lock and coherent metadata/pointer/checkpoint snapshot under lock;
5. validate transitions, outcome, origin, evidence, and story versions;
6. classify checkpoint;
7. initialize canonical store, lobby, or floor-only/safety recovery;
8. recheck latest generation;
9. retry on change;
10. attach installing receiver only when permitted.

## Floor-only and supersession recovery

Floor-only UI disables controls, displays current story/session identity, requests complete canonical state, and can send/consume floor evidence. A stale session receiving a transition chain visibly moves to current active recovery or current ended lobby.

## Safety phases

Include:

- `safety-capacity`: network higher-epoch recovery or explicit reset;
- `safety-digest-collision`: protocol upgrade/reset only;
- `capability-lock-unavailable`: local reprobe only;
- `storage-failure`: local repair/reload only.

The UI never suggests a recovery mechanism that the gate will reject.

## Canonical store

React subscribes via `useSyncExternalStore`. It does not mirror outcome, origin, transitions, lineage, dispositions, certificates, generation, or safety lock in independent refs.

## User-action freshness

Every novella command refreshes latest generation before authority checks. Stale or safety-locked tabs cannot enqueue one last action.

## Messages

- rollback: another valid timeline won and local actions rolled back;
- superseded: this older session was replaced; current room story is being restored;
- completed end: current exact session already ended;
- floor-only: latest canonical state is being recovered;
- capacity: safety evidence limit reached; only newer verified epoch/reset may continue;
- digest collision: protocol safety conflict requires reset/upgrade;
- lock unavailable: browser cannot provide required cross-tab locking;
- storage failure: local persistence must recover before novella sync resumes.

Chat, voice, video, screen share, and files remain available in every novella phase.
