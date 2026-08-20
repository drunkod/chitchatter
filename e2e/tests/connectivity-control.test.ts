// Target: e2e/tests/connectivity-control.test.ts (replace — rev 2)
//
// FIX for the previous control's false "infrastructure limit" verdict.
//
// The old control waited for peer visibility on A ONLY, then immediately
// sent a chat message. Chitchatter delivers a message only to peers that
// are connected AT SEND TIME — so a message sent while B is still
// connecting is lost permanently, and B never displays it even after it
// connects. The observed asymmetry (A sees B, B still "Searching…") is
// exactly that race, not a broken environment.
//
// The passing classic suite always waits for peer visibility on BOTH
// sides (waitForPeerConnected twice) BEFORE waitForBidirectionalPeerTraffic.
// This control now does the same, and additionally re-sends the probe
// message on an interval so a late-opening data channel still delivers.

import { expect, Page, test } from '@playwright/test'

const roomMessageInput = (page: Page) =>
  page.getByPlaceholder('Your message').first()

const peerListOpenButton = (page: Page) =>
  page.getByRole('button', { name: 'Peer list', exact: true })

const peerListCloseButton = (page: Page) =>
  page.getByRole('button', { name: 'Close peer list', exact: true })

// PeerList always renders a SELF ListItem, so `getByRole('listitem')` is a
// false positive. "Searching for peers..." renders iff peerList.length === 0,
// so its ABSENCE is the only self-proof signal.
const waitForPartnerConnected = async (page: Page, label: string) => {
  const closeButton = peerListCloseButton(page)

  if (!(await closeButton.isVisible())) {
    await peerListOpenButton(page).click()
    await expect(closeButton).toBeVisible()
  }

  await expect(page.getByText('Searching for peers...')).toBeHidden({
    timeout: 90_000,
  })
  console.log(`[control] PEER ${label}: partner connected`)

  await closeButton.click()
  await expect(closeButton).toBeHidden()
}

// Re-send on an interval: if the data channel opens a moment after the
// peer appears, an earlier message would have been dropped silently.
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

      console.log(`[control] CHAT: delivered on attempt ${attempt}`)

      return
    } catch {
      attempt += 1
    }
  }

  throw new Error(`Message never delivered after ${attempt} attempts`)
}

test('control: two isolated contexts connect in a plain room', async ({
  browser,
}) => {
  test.setTimeout(300_000)

  const roomUrl = `/public/control-${Date.now()}`
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()

  try {
    const a = await contextA.newPage()
    const b = await contextB.newPage()

    for (const [page, label] of [
      [a, 'a'],
      [b, 'b'],
    ] as const) {
      page.on('console', message => {
        if (message.type() === 'error') {
          console.log(`[browser:${label}] ${message.text()}`)
        }
      })
    }

    await a.goto(roomUrl)
    await expect(roomMessageInput(a)).toBeVisible({ timeout: 30_000 })

    // Announce window before the second peer arrives.
    await a.waitForTimeout(4_000)

    await b.goto(roomUrl)
    await expect(roomMessageInput(b)).toBeVisible({ timeout: 30_000 })

    // BOTH sides must see a partner before any traffic is sent.
    await waitForPartnerConnected(a, 'a')
    await waitForPartnerConnected(b, 'b')

    await deliverMessage(a, b, `control-a-${Date.now()}`)
    await deliverMessage(b, a, `control-b-${Date.now()}`)
    console.log('[control] BIDIRECTIONAL: confirmed')
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
