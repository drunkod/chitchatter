# 16 — Test matrices and failure-injection transport

> **Revision 7 changes:** the concrete test transport now uses the link network it describes, and matrices cover the corrected gate ordering, identity-safe gossip, full-state election ordering, metadata bootstrap, and visible rollback.

## Required matrices

### Validation

- fresh-object normalization for every nested payload;
- start decision ID binding and sender/coordinator checks;
- gossip outer identity independent of embedded coordinator;
- reconciliation state semantic validation;
- canonical election electorate and digest binding;
- RoomMeta normalization, retained end envelopes, active start decision, count and byte bounds.

### Gate and recovery

- `START_PROPOSE@epoch n` drops when high-water is `n`;
- `START_COMMITTED@epoch n` and gossip reach reconciliation when high-water is `n`;
- older decisions drop;
- duplicate `SESSION_ENDED` returns `reack-end` before tombstone handling;
- tombstoned requests/progression return `reply-ended`;
- solicited snapshot requires request ID **and exact target peer**.

### Start reconciliation

- original commit envelope forwarded by a holder fails identity validation in a negative test;
- `START_DECISION_GOSSIP` from that holder succeeds;
- partial commit + coordinator crash + replacement decision converges after heal;
- revision and full-state tie-breaks are delivery-order independent;
- losing partition enters `reconciling`, clears checkpoint, and reports rollback;
- active decision survives reload.

### Election

- first announcement changes controller; second announcement for the same original departure can still supersede;
- same epoch/revision/controller but different session/content has a deterministic winner;
- divergent local electorates converge after delivery;
- stale epoch and connected departed peer are rejected.

### Termination

- send resolves on enqueue but no finalization without ACKs;
- first ACK dropped, duplicate end causes re-ack;
- stale progression receives retained end;
- critical metadata write failure keeps controller in terminating state;
- retained notice survives reload.

## Link network

```ts
type LinkState = 'up' | 'down'

interface QueuedDelivery {
  id: number
  from: string
  to: string
  key: string
  data: unknown
  deliver: () => void
}

export class TestMeshNetwork {
  private peers = new Set<string>()
  private links = new Map<string, LinkState>()
  private queue: QueuedDelivery[] = []
  private nextId = 1
  auto = false

  private peerIds = () => [...this.peers]

  registerPeer(peerId: string) {
    for (const other of this.peerIds()) {
      this.links.set(`${peerId}->${other}`, 'up')
      this.links.set(`${other}->${peerId}`, 'up')
    }
    this.peers.add(peerId)
  }

  unregisterPeer(peerId: string) {
    this.peers.delete(peerId)
  }

  setLink(from: string, to: string, state: LinkState) {
    this.links.set(`${from}->${to}`, state)
  }

  canSee(from: string, to: string) {
    return this.links.get(`${from}->${to}`) !== 'down'
  }

  enqueue(input: Omit<QueuedDelivery, 'id'>) {
    if (!this.canSee(input.from, input.to)) return
    this.queue.push({ ...input, id: this.nextId++ })
    if (this.auto) this.pump()
  }

  pump(count = Number.POSITIVE_INFINITY) {
    for (let i = 0; i < count && this.queue.length > 0; i++) {
      this.queue.shift()!.deliver()
    }
  }

  pumpIds(ids: number[]) {
    for (const id of ids) {
      const index = this.queue.findIndex(item => item.id === id)
      if (index >= 0) this.queue.splice(index, 1)[0]!.deliver()
    }
  }

  dropWhere(predicate: (item: QueuedDelivery) => boolean) {
    this.queue = this.queue.filter(item => !predicate(item))
  }

  partition(a: string[], b: string[]) {
    for (const left of a) for (const right of b) {
      this.setLink(left, right, 'down')
      this.setLink(right, left, 'down')
    }
  }

  heal() {
    for (const from of this.peerIds()) for (const to of this.peerIds()) {
      if (from !== to) this.setLink(from, to, 'up')
    }
  }

  deliverPartiallyThenCrash(sender: TestTransport, recipients: string[]) {
    const allowed = new Set(recipients)
    const ids = this.queue
      .filter(item => item.from === sender.peerId && allowed.has(item.to))
      .map(item => item.id)
    this.pumpIds(ids)
    sender.disconnect()
  }
}
```

## Concrete transport

```ts
export class TestTransport implements VisualNovelTransport {
  private receivers = new Map<string, Set<Receiver>>()
  private joinHandlers = new Map<PeerHookType, (peerId: string) => void>()
  private leaveHandlers = new Map<PeerHookType, (peerId: string) => void>()

  constructor(
    readonly peerId: string,
    private readonly peers: Map<string, TestTransport>,
    private readonly network: TestMeshNetwork,
  ) {
    peers.set(peerId, this)
    network.registerPeer(peerId)
    for (const other of peers.values()) {
      if (other === this) continue
      for (const handler of other.joinHandlers.values()) handler(peerId)
    }
  }

  getSelfId = () => this.peerId
  getPeers = () => [...this.peers.keys()].filter(
    id => id !== this.peerId && this.network.canSee(this.peerId, id)
  )

  makeAction = <T extends DataPayload>(
    peerAction: PeerAction,
    namespace: string,
  ): PeerRoomAction<T> => {
    const key = `${namespace}.${peerAction}`
    if (!this.receivers.has(key)) this.receivers.set(key, new Set())

    const send: PeerRoomAction<T>[0] = async (data, options) => {
      const targets = options?.target
        ? (Array.isArray(options.target) ? options.target : [options.target])
        : this.getPeers()
      for (const target of targets) {
        const remote = this.peers.get(target)
        if (!remote) continue
        this.network.enqueue({
          from: this.peerId,
          to: target,
          key,
          data: structuredClone(data),
          deliver: () => {
            for (const receiver of remote.receivers.get(key) ?? []) {
              receiver(structuredClone(data), { peerId: this.peerId } as MessageContext)
            }
          },
        })
      }
      // Resolve on enqueue intentionally; tests control actual delivery.
    }

    const connectReceiver: PeerRoomAction<T>[1] = receiver => {
      this.receivers.get(key)!.add(receiver as Receiver)
      return () => { this.receivers.get(key)!.delete(receiver as Receiver) }
    }
    const progress: PeerRoomAction<T>[2] = () => undefined
    return [send, connectReceiver, progress]
  }

  onPeerJoin = (type: PeerHookType, handler: (peerId: string) => void) => {
    this.joinHandlers.set(type, handler)
  }

  onPeerLeave = (type: PeerHookType, handler: (peerId: string) => void) => {
    this.leaveHandlers.set(type, handler)
  }

  removePeerJoinHandler = (type: PeerHookType) => { this.joinHandlers.delete(type) }
  removePeerLeaveHandler = (type: PeerHookType) => { this.leaveHandlers.delete(type) }

  disconnect = () => {
    this.peers.delete(this.peerId)
    this.network.unregisterPeer(this.peerId)
    for (const other of this.peers.values()) {
      for (const handler of other.leaveHandlers.values()) handler(this.peerId)
    }
  }
}
```

The test network, not the global peer map, now controls `getPeers()` and delivery.

## CI

Unit, type, lint, build, and focused E2E suites must appear as status checks on the feature branch. Documentation-only commits may have no runs, but implementation merge gates may not.
