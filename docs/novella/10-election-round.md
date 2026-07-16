# 10 — Controller migration and supersession

> **Revision 7 changes:** preserves the original departed-controller identity after the first announcement, makes supersession total over the complete adopted state, and reuses the shared reconciliation comparator.

## Local election round

Each peer opens a local round when its current controller leaves:

```ts
const electorate = [...new Set([selfId, ...transport.getPeers()])]
  .filter(id => id !== departedControllerPeerId)
  .sort()

const roundId = deriveRoundId(
  `${state.sessionEpoch}:${departedControllerPeerId}:${electorate.join(',')}`
)
```

The local round controls advertisement collection only. It is not assumed to be a globally agreed membership certificate.

## Durable migration record

The first accepted announcement must not erase the departure that authorizes later supersession:

```ts
interface MigrationRecord {
  sessionEpoch: number
  departedControllerPeerId: string
  openedAt: number
  closesAt: number
  lastAppliedState: VisualNovelSessionState | null
}
```

Open it on the leave event. If a peer missed the leave event, it may create the record from an internally consistent announcement only when:

- `payload.departedControllerPeerId === current.controllerPeerId`;
- the departed peer is absent from its transport view;
- the state epoch is not older.

After applying the first announcement, authorization continues to compare against `migration.departedControllerPeerId`, not the newly installed `current.controllerPeerId`.

## Advertisement and announcement

```text
remaining peers → local winner: ELECTION_ADVERTISE(local round, own state)
local winner: choose best state, change controller, broadcast CONTROLLER_CHANGED
```

The announcement includes canonical electorate fields and a digest-bound `roundId`. The announced controller must be the minimum ID in that electorate and the transport sender.

## Authorization

```ts
authorizeControllerChange(
  payload: VisualNovelPayloadByAction['CONTROLLER_CHANGED'],
  current: VisualNovelSessionState,
  contextPeerId: string,
  connectedPeers: string[],
  migration: MigrationRecord | null,
  now: number,
): boolean {
  if (payload.controllerPeerId !== contextPeerId) return false
  if (payload.controllerPeerId !== electController(payload.electorate)) return false
  if (connectedPeers.includes(payload.departedControllerPeerId)) return false

  const active = migration && now <= migration.closesAt ? migration : null
  if (active) {
    if (payload.departedControllerPeerId !== active.departedControllerPeerId) return false
    if (payload.state.sessionEpoch !== active.sessionEpoch) return false
  } else {
    if (payload.departedControllerPeerId !== current.controllerPeerId) return false
  }

  if (payload.state.sessionEpoch < current.sessionEpoch) return false

  const baseline = active?.lastAppliedState ?? current
  return compareSessionPriority(payload.state, baseline) > 0 ||
    stableStateString(payload.state) === stableStateString(baseline)
}
```

Equal normalized state is an idempotent no-op. A genuinely different state must strictly win the shared comparator.

## Applying and superseding

```ts
const applyControllerChange = async (envelope, context) => {
  const incoming = envelope.payload.state
  const record = ensureMigrationRecord(envelope.payload, stateRef.current)
  if (!authorizeControllerChange(/* ... */)) return

  if (stableStateString(incoming) !== stableStateString(stateRef.current!)) {
    setPhase('reconciling')
    clearCheckpointIfSessionChanged(stateRef.current!, incoming)
    setState(incoming)
  }
  record.lastAppliedState = incoming
  record.closesAt = now() + visualNovelLimits.migrationSupersessionMs
  sync.commit(envelope)
}
```

`lastAppliedState` survives local round restarts and the first controller replacement until the supersession window closes.

## Divergent local views

B may announce from `{B,C}` while C announces from `{C}`. Both are internally consistent. Once both announcements are delivered, every peer compares the complete adopted states using the same total comparator. The lower-ID winner is only one tie-break; differing session IDs or state content cannot remain arrival-order-dependent.

## Interaction with start conflicts

If migration occurs while populations hold different same-epoch sessions, announcements carry those complete states. The shared comparator chooses one. Losing peers show reconciliation and replace atomically. This is the same availability-with-rollback behavior documented in 00/09.

## Tests

- second announcement remains authorized after the first controller is installed;
- two equal epoch/revision/controller announcements with different session or content converge deterministically;
- local electorate disagreement does not cause `wrong-round` deadlock;
- departed peer still connected is rejected;
- announcement fields and digest binding are normalized and checked;
- migration record expires only after the supersession window and is not overwritten by unrelated join/leave events.
