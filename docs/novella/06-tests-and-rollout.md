# 06 — Tests, manual validation, and rollout

## Unit-test matrix

### Validator

- Valid complete story and every action payload.
- Missing start scene, empty dialogue, duplicate IDs, nonexistent transitions.
- Unknown asset keys, path traversal, external origins, unsupported extensions.
- Unknown action/effect/operator, unsupported protocol, invalid numbers.
- Oversized envelope, snapshot, history, variables, text, and identifiers.
- Envelope sender ID different from Trystero `MessageContext.peerId`.

### Engine

- Start, sequential advance, explicit transition, both choices and endings.
- Conditions, set/increment effects, unavailable choice, choice-required error.
- End-of-branch, restart, controller change, history bound, story mismatch.
- Immutability: input state and manifest are not mutated.

### Sync service

- Apply exact next revision, ignore duplicate/stale, recover on gap.
- Reject story/version/session/controller/sender mismatch.
- Target late-join snapshot and accept only valid snapshots.
- Deterministic election and highest-revision state choice.
- Concurrent same-revision requests yield one canonical transition.

## `VisualNovelEngine.test.ts`

```ts
describe('VisualNovelEngine', () => {
  const makeEngine = () => new VisualNovelEngine(exampleStory, { now: () => 1234 })

  it.each([
    ['light-beacon', 'beacon-ending', { usedBeacon: true, courage: 1 }],
    ['wait-for-dawn', 'dawn-ending', { usedBeacon: false, patience: 1 }],
  ])('resolves %s canonically', (choiceId, sceneId, variables) => {
    const engine = makeEngine()
    const atChoice = engine.advance(engine.start('session-1', 'peer-a'))
    const result = engine.choose(atChoice, choiceId)
    expect(result).toMatchObject({ sceneId, variables, revision: 2 })
    expect(atChoice.sceneId).toBe('pier')
  })

  it('requires a choice instead of advancing past it', () => {
    const engine = makeEngine()
    const atChoice = engine.advance(engine.start('session-1', 'peer-a'))
    expect(() => engine.advance(atChoice)).toThrow('Resolve a choice')
  })
})
```

## `VisualNovelSyncService.test.ts`

```ts
it('requests recovery for an event gap', () => {
  const service = new VisualNovelSyncService()
  const result = service.inspectCanonical(
    makeEnvelope({ revision: 4, senderPeerId: 'peer-a' }),
    makeState({ revision: 2, controllerPeerId: 'peer-a' }),
    'peer-a'
  )
  expect(result).toEqual({ kind: 'recover', reason: 'revision-gap' })
})

it('ignores a duplicate action ID', () => {
  const service = new VisualNovelSyncService()
  const envelope = makeEnvelope({ actionId: 'same', revision: 2 })
  service.inspectCanonical(envelope, makeState({ revision: 1 }), 'peer-a')
  expect(service.inspectCanonical(envelope, makeState({ revision: 1 }), 'peer-a'))
    .toEqual({ kind: 'ignore', reason: 'duplicate' })
})

it('elects the same peer regardless of input order', () => {
  const service = new VisualNovelSyncService()
  expect(service.electController(['peer-z', 'peer-a', 'peer-b'])).toBe('peer-a')
  expect(service.electController(['peer-b', 'peer-z', 'peer-a'])).toBe('peer-a')
})
```

## In-memory transport for hook tests

```ts
class TestPeerRoom {
  private receivers = new Map<string, (data: unknown, context: MessageContext) => void>()
  constructor(readonly peerId: string, private readonly mesh: Map<string, TestPeerRoom>) {
    mesh.set(peerId, this)
  }

  makeAction<T>(_action: PeerAction, namespace: string) {
    const send = async (data: T, options?: { target?: string | string[] }) => {
      const targets = options?.target
        ? (Array.isArray(options.target) ? options.target : [options.target])
        : [...this.mesh.keys()].filter(id => id !== this.peerId)
      for (const target of targets) {
        this.mesh.get(target)?.receivers.get(namespace)?.(
          structuredClone(data),
          { peerId: this.peerId } as MessageContext
        )
      }
    }
    const connect = (receiver: (data: T, context: MessageContext) => void) =>
      this.receivers.set(namespace, receiver as never)
    const disconnect = () => this.receivers.delete(namespace)
    return [send, connect, () => {}, disconnect] as const
  }
}
```

Use it to mount controller and participant hooks and assert targeted requests, one broadcast, equal states, duplicate suppression, revision-gap recovery, late join, and controller leave.

## Component tests

```tsx
it('renders dialogue and submits a participant choice request', async () => {
  const choose = vi.fn().mockResolvedValue(undefined)
  render(
    <VisualNovelContext.Provider value={makeContext({
      entry: { id: 'pier-2', speaker: 'Sol', text: 'What should we do?' },
      availableChoices: [{ id: 'beacon', label: 'Light the beacon', nextSceneId: 'end' }],
      isController: false,
      choose,
    })}>
      <DialogueBox />
      <ChoiceList />
    </VisualNovelContext.Provider>
  )
  expect(screen.getByText('What should we do?')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: /Light the beacon/ }))
  expect(choose).toHaveBeenCalledWith('beacon')
})
```

Also test lobby, asset fallback, loading/sync/error/waiting states, controller badge, pending controls, restart dialog, keyboard focus order, and mobile Story/Chat switching.

## `e2e/visual-novel.spec.ts`

```ts
import { expect, test } from '@playwright/test'

test('two peers share a branch and survive controller departure', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const a = await contextA.newPage()
  const b = await contextB.newPage()
  const roomUrl = '/public/novella-e2e'

  await Promise.all([a.goto(roomUrl), b.goto(roomUrl)])
  await a.getByRole('button', { name: 'Start Harbour Lights' }).click()
  await expect(b.getByText('The harbour beacon is dark')).toBeVisible()

  await b.getByRole('button', { name: 'Continue' }).click()
  await expect(a.getByText('What should we do?')).toBeVisible()
  await b.getByRole('button', { name: /Light the old beacon/ }).click()
  await expect(a.getByText('The lens catches')).toBeVisible()
  await expect(b.getByText('The lens catches')).toBeVisible()

  await contextA.close()
  await expect(b.getByText(/You control the story/i)).toBeVisible()
  await b.getByRole('button', { name: 'Continue' }).click()
  await expect(b.getByText('They found the channel')).toBeVisible()
})

test('late join and refresh recover the current snapshot', async ({ browser }) => {
  // Start and progress in A, join with B, compare scene/dialogue/revision,
  // reload B, then assert the same canonical state returns.
})
```

Use the actual route configured by the current repository when implementing; the example path is illustrative.

## Existing-feature regressions

- Send chat before/during/after story transitions.
- Start/stop microphone while choices are visible.
- Verify video remains optional and can start without remounting the story.
- Verify file sharing and direct-message navigation remain functional.
- Exercise public and password-protected rooms without logging secrets.
- Confirm leaving a novella handler does not flush audio/video/chat lifecycle handlers.

## Manual matrix

### Two windows / different profiles

1. Start the normal development stack.
2. Join the same room in isolated profiles.
3. Confirm voice and text chat.
4. Start the example story and request actions from both peers.
5. Confirm identical scene/dialogue/revision after every action.
6. Refresh the participant and verify snapshot recovery.
7. Close the controller and verify migration without restart.

### Same-network devices

Use an HTTPS/secure-context development URL. Test portrait/landscape, microphone permissions, backgrounding, and reconnect.

### Different-network devices

Test with configured TURN. Record direct/relay status and latency. A failed peer connection without working TURN is a connectivity limitation, not necessarily a novella protocol defect.

## README additions

- Normal local startup and two-profile test setup.
- Starting a story using the existing room URL.
- Controller/request/revision/snapshot/election semantics.
- Story schema, safe asset rules, catalog registration, and example.
- Late join, refresh, and checkpoint behavior.
- Browser autoplay and independent story volume controls.
- Tracker/STUN/TURN/ad-blocker/cross-domain limitations.
- Privacy statement: no central progress storage, accounts, or analytics.

## Rollout sequence

1. Merge pure models/validator/engine/story behind no visible UI.
2. Add local-only UI behind a development feature flag.
3. Add two-peer sync, snapshots, and recovery tests.
4. Add controller migration and concurrency hardening.
5. Enable bundled example story by default after full regression pass.

## Command gate

```bash
npm test -- --run
npm run check:types
npm run lint
npm run build
npm run test:e2e -- e2e/visual-novel.spec.ts
```

Review the final diff for secrets, private URLs, external trackers, analytics, raw HTML, executable story content, unbounded payloads, unlicensed assets, duplicate room/microphone creation, and unrelated formatting.

