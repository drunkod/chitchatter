// Target: e2e/duet/duet-novellas.test.ts (replace — rev 6)
//
// CHANGES vs rev 2 (which failed proveConnectivity):
//
// 1. NO second navigation for player B. Their role selection is injected
//    into sessionStorage via context.addInitScript, and B joins player A's
//    exact URL in ONE navigation — a single PeerRoom lifecycle, no
//    re-announce churn (rev 2's enterFollowing joined B's own bucket room
//    first, then reloaded into A's room).
// 2. WebSocket instrumentation: every tracker socket open/close/error on
//    both pages is logged, so a failing run shows whether both peers even
//    reached ws://localhost:8000.
// 3. A DIAGNOSTIC test runs FIRST: plain room, no gateway, no novella.
//
// REV 5 — two harness fixes (see ARCHITECTURE.md):
//
// A. VALID connectivity locator. PeerList always renders a SELF ListItem,
//    so `getByRole('listitem').first()` was a false positive. PeerList
//    renders "Searching for peers..." exactly when peerList.length === 0,
//    so the ABSENCE of that text is the one signal that cannot match self.
//
// B. ANNOUNCE WINDOW before the second peer joins. The passing classic
//    helper (joinExistingRoom) navigates to '/' and reads the username
//    BEFORE going to the room — several seconds during which the first
//    peer completes its tracker announce. Our tests joined B immediately
//    after A's shell rendered, so A had mounted PeerRoom but not
//    necessarily announced. rev 5 reproduces that dwell explicitly.
//
// C. (rev 6) RESEND-RETRY on the chat probe. Chitchatter delivers a
//    message only to peers connected AT SEND TIME, so a probe sent while
//    the data channel is still opening is dropped silently and never
//    appears — even after the peer connects. The probe is now re-sent on
//    an interval until it lands.

import { BrowserContext, expect, Page, test } from '@playwright/test'

interface NovellaSpec {
  id: string
  title: string
  roleIds: [string, string]
  roles: [string, string]
  opening: string
  afterContinue: string
  choice: string
  afterChoice: string
}

// Mirrors src/config/duets.ts and the bundled story.json files.
const NOVELLAS: NovellaSpec[] = [
  {
    id: 'two-lanterns',
    title: 'Two Lanterns',
    roleIds: ['keeper', 'sailor'],
    roles: ['The Keeper', 'The Sailor'],
    opening:
      'The harbour beacon is dark, and the fishing boat is still outside the breakwater.',
    afterContinue: 'We have time for one signal. What should we do?',
    choice: 'Light the old beacon',
    afterChoice: 'The lens catches, then floods the water with gold.',
  },
  {
    id: 'masquerade',
    title: 'Masquerade',
    roleIds: ['fox', 'raven'],
    roles: ['The Fox', 'The Raven'],
    opening:
      'The candles are down to their last inch, and the orchestra is playing the song that means midnight is close.',
    afterContinue: 'At the unmasking hour, every guest must choose.',
    choice: 'Remove the masks together',
    afterChoice: 'Two masks come away at once, and the room holds its breath.',
  },
  {
    id: 'signal-static',
    title: 'Signal / Static',
    roleIds: ['cold-river', 'last-orchard'],
    roles: ['COLD RIVER', 'LAST ORCHARD'],
    opening:
      'Three in the morning. The band has been empty for hours — then, under the static, a third signal. Faint. Repeating.',
    afterContinue: 'It is not addressed to anyone.',
    choice: 'Answer the signal',
    afterChoice:
      'Two stations key at once — a chord where there should be a note.',
  },
  {
    id: 'ink-echo',
    title: 'Ink & Echo',
    roleIds: ['ink', 'echo'],
    roles: ['Ink', 'Echo'],
    opening:
      "A sheet of paper, half-filled, ends mid-sentence: 'She opened the door and—'",
    afterContinue: 'Ink decides what happens. Echo decides what it means.',
    choice: 'Write the storm in',
    afterChoice:
      '—the rain came in sideways, and the candles went out all at once.',
  },
]

const novella = (page: Page) => page.getByRole('region', { name: 'Novella' })

const roomMessageInput = (page: Page) =>
  page.getByPlaceholder('Your message').first()

const peerListOpenButton = (page: Page) =>
  page.getByRole('button', { name: 'Peer list', exact: true })

const peerListCloseButton = (page: Page) =>
  page.getByRole('button', { name: 'Close peer list', exact: true })

// Announce window: the dwell the classic helper gets for free by loading
// '/' and reading the username before entering the room.
const ANNOUNCE_WINDOW_MS = 4_000

// The ONLY peer signal that cannot match the local user: PeerList renders
// "Searching for peers..." iff peerList.length === 0, so its absence means
// a real remote peer registered.
const waitForPartnerConnected = async (page: Page, label: string) => {
  const closeButton = peerListCloseButton(page)
  const wasOpen = await closeButton.isVisible()

  if (!wasOpen) {
    await peerListOpenButton(page).click()
    await expect(closeButton).toBeVisible()
  }

  await expect(page.getByText('Searching for peers...')).toBeHidden({
    timeout: 90_000,
  })
  console.log(`[peers:${label}] partner connected`)

  if (!wasOpen) {
    await closeButton.click()
    await expect(closeButton).toBeHidden()
  }
}

const waitForRoomReady = async (page: Page) => {
  await expect(roomMessageInput(page)).toBeVisible({ timeout: 30_000 })
}

const expectDialogue = async (page: Page, text: string) => {
  await expect(novella(page).getByText(text)).toBeVisible({ timeout: 45_000 })
}

const enterViaGateway = async (
  page: Page,
  spec: NovellaSpec,
  roleTitle: string
): Promise<string> => {
  await page.goto('/')
  await page.getByRole('button', { name: `Choose ${spec.title}` }).click()
  await page.getByRole('button', { name: `Choose ${roleTitle}` }).click()
  await page.waitForURL(new RegExp(`/public/${spec.id}-stage-\\d+`), {
    timeout: 15_000,
  })
  await waitForRoomReady(page)

  return page.url()
}

// Player B: role injected BEFORE any page script runs, then a single
// navigation straight into player A's room. One PeerRoom lifecycle.
const joinDirectly = async (
  context: BrowserContext,
  spec: NovellaSpec,
  roleId: string
): Promise<Page> => {
  await context.addInitScript(
    ([novellaId, role]) => {
      window.sessionStorage.setItem(
        'novella-duet-selection',
        JSON.stringify({ novellaId, roleId: role })
      )
    },
    [spec.id, roleId] as const
  )

  const page = await context.newPage()

  return page
}

// Re-send until delivered: a message sent before the data channel is open
// is dropped silently (chitchatter delivers only to peers connected at
// send time), so a single send can never recover from that race.
const deliverMessage = async (
  sender: Page,
  receiver: Page,
  baseText: string
) => {
  const deadline = Date.now() + 60_000
  let attempt = 0

  while (Date.now() < deadline) {
    const text = `${baseText}-${attempt}`

    await roomMessageInput(sender).fill(text)
    await roomMessageInput(sender).press('Enter')

    try {
      await expect(
        receiver.getByText(text, { exact: true }).first()
      ).toBeVisible({ timeout: 10_000 })

      return
    } catch {
      attempt += 1
    }
  }

  throw new Error(`Message never delivered after ${attempt} attempts`)
}

const proveConnectivity = async (a: Page, b: Page, label: string) => {
  // Primary: BOTH sides must see a real remote peer before any traffic.
  await waitForPartnerConnected(a, `${label}:a`)
  await waitForPartnerConnected(b, `${label}:b`)

  // Secondary: an actual round trip, resent until it lands.
  const nonce = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`

  await deliverMessage(a, b, `${nonce}-a`)
  await deliverMessage(b, a, `${nonce}-b`)
  console.log(`[chat:${label}] bidirectional delivery confirmed`)
}

const actFromTurnHolder = async (pages: Page[], buttonName: string) => {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    for (const page of pages) {
      const button = novella(page).getByRole('button', {
        name: buttonName,
        exact: true,
      })

      if ((await button.count()) > 0 && (await button.isEnabled())) {
        await button.click()

        return page
      }
    }

    await pages[0].waitForTimeout(500)
  }

  throw new Error(`No page had an enabled "${buttonName}" button`)
}

interface Pair {
  a: Page
  b: Page
  contextA: BrowserContext
  contextB: BrowserContext
}

const startPair = async (
  browser: import('@playwright/test').Browser,
  spec: NovellaSpec
): Promise<Pair> => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()

  const a = await contextA.newPage()

  const roomUrl = await enterViaGateway(a, spec, spec.roles[0])

  // Let player A announce to the tracker before player B arrives.
  await a.waitForTimeout(ANNOUNCE_WINDOW_MS)

  const b = await joinDirectly(contextB, spec, spec.roleIds[1])

  await b.goto(roomUrl)
  await waitForRoomReady(b)

  await proveConnectivity(a, b, spec.id)

  return { a, b, contextA, contextB }
}

test.describe('Duet novellas', () => {
  test.describe.configure({ timeout: 180_000 })

  test('diagnostic: plain-room chat connectivity under the duet server', async ({
    browser,
  }) => {
    // No gateway, no novella logic, no stage-room naming: two contexts in a
    // throwaway room, chat both ways. If THIS fails, P2P itself is broken
    // under this server config and the novella tests are innocent.
    const roomUrl = `/public/duet-diagnostic-${Date.now()}`
    let contextA: BrowserContext | undefined
    let contextB: BrowserContext | undefined

    try {
      contextA = await browser.newContext()
      contextB = await browser.newContext()
      const a = await contextA.newPage()
      const b = await contextB.newPage()

      await a.goto(roomUrl)
      await waitForRoomReady(a)
      await a.waitForTimeout(ANNOUNCE_WINDOW_MS)
      await b.goto(roomUrl)
      await waitForRoomReady(b)

      await proveConnectivity(a, b, 'diag')
    } finally {
      await contextA?.close()
      await contextB?.close()
    }
  })

  for (const spec of NOVELLAS) {
    test(`${spec.title}: pairs two strangers, auto-starts, and plays a full branch`, async ({
      browser,
    }) => {
      let pair: Pair | undefined

      try {
        pair = await startPair(browser, spec)
        const { a, b } = pair

        await expectDialogue(a, spec.opening)
        await expectDialogue(b, spec.opening)

        await actFromTurnHolder([a, b], 'Continue')
        await expectDialogue(a, spec.afterContinue)
        await expectDialogue(b, spec.afterContinue)

        await actFromTurnHolder([a, b], spec.choice)
        await expectDialogue(a, spec.afterChoice)
        await expectDialogue(b, spec.afterChoice)
      } finally {
        await pair?.contextA.close()
        await pair?.contextB.close()
      }
    })
  }

  test('turn gating: the non-active side is locked while the active side can act (Two Lanterns)', async ({
    browser,
  }) => {
    const spec = NOVELLAS[0]
    let pair: Pair | undefined

    try {
      pair = await startPair(browser, spec)
      const { a, b } = pair

      await expectDialogue(a, spec.opening)
      await expectDialogue(b, spec.opening)

      const active = await actFromTurnHolder([a, b], 'Continue')
      const passive = active === a ? b : a

      await expectDialogue(active, spec.afterContinue)
      await expectDialogue(passive, spec.afterContinue)

      await expect(passive.getByText('Your move', { exact: true })).toBeVisible(
        { timeout: 15_000 }
      )
      await expect(active.getByText('Their move', { exact: true })).toBeVisible(
        { timeout: 15_000 }
      )

      await expect(
        novella(active).getByRole('button', { name: spec.choice, exact: true })
      ).toBeDisabled()
    } finally {
      await pair?.contextA.close()
      await pair?.contextB.close()
    }
  })

  test('partner departure: story pauses and the survivor claims control (Two Lanterns)', async ({
    browser,
  }) => {
    const spec = NOVELLAS[0]
    let pair: Pair | undefined

    try {
      pair = await startPair(browser, spec)
      const { a, b, contextA } = pair

      await expectDialogue(a, spec.opening)
      await expectDialogue(b, spec.opening)

      await contextA.close()

      await expect(
        novella(b).getByText('The other light went out. The story is paused.')
      ).toBeVisible({ timeout: 30_000 })

      await novella(b)
        .getByRole('button', { name: 'Carry both lanterns' })
        .click()

      await actFromTurnHolder([b], 'Continue')
      await expectDialogue(b, spec.afterContinue)
    } finally {
      await pair?.contextB.close()
    }
  })
})
