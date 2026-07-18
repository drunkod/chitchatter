import { Page, expect } from '@playwright/test'

export interface JoinedRoom {
  roomUrl: string
  userId: string
}

export interface WaitForPeerConnectedOptions {
  keepPeerListOpen?: boolean
}

const roomMessageInput = (page: Page) =>
  page.getByPlaceholder('Your message').first()

const peerListOpenButton = (page: Page) =>
  page.getByRole('button', {
    name: 'Peer list',
    exact: true,
  })

const peerListCloseButton = (page: Page) =>
  page.getByRole('button', {
    name: 'Close peer list',
    exact: true,
  })

const messageLocator = (page: Page, message: string) =>
  page.getByText(message, { exact: true }).first()

/**
 * Wait only for the room's interactive shell.
 *
 * Tracker and WebRTC readiness must be proven separately through actual peer
 * visibility and message delivery. UI loading copy is not a reliable network
 * readiness signal.
 */
export const waitForRoomReady = async (page: Page): Promise<void> => {
  await expect(roomMessageInput(page)).toBeVisible({
    timeout: 30_000,
  })
}

export const getCurrentUserId = async (page: Page): Promise<string> => {
  const username = page.getByText(/Your username:/).first()

  await expect(username).toBeVisible({
    timeout: 30_000,
  })

  const text = await username.textContent()
  const userId = text?.replace(/^.*Your username:\s*/, '').trim()

  if (!userId) {
    throw new Error('Could not read the generated Chitchatter username')
  }

  return userId
}

export const joinPublicRoom = async (page: Page): Promise<JoinedRoom> => {
  await page.goto('/')

  const userId = await getCurrentUserId(page)

  await page
    .getByRole('button', {
      name: /join public room/i,
    })
    .click()

  await page.waitForURL(/\/public\/.+/)
  await waitForRoomReady(page)

  return {
    roomUrl: page.url(),
    userId,
  }
}

export const joinExistingRoom = async (
  page: Page,
  roomUrl: string
): Promise<string> => {
  await page.goto('/')

  const userId = await getCurrentUserId(page)

  await page.goto(roomUrl)
  await waitForRoomReady(page)

  return userId
}

export const sendMessage = async (
  page: Page,
  message: string
): Promise<void> => {
  const chatInput = roomMessageInput(page)

  await chatInput.fill(message)
  await chatInput.press('Enter')

  await expect(messageLocator(page, message)).toBeVisible({
    timeout: 10_000,
  })
}

/**
 * Wait until a specific peer appears in the peer list.
 *
 * By default this restores the peer list to its original closed state so that
 * the helper does not affect later story controls.
 */
export const waitForPeerConnected = async (
  page: Page,
  peerUserId: string,
  options: WaitForPeerConnectedOptions = {}
): Promise<void> => {
  const { keepPeerListOpen = false } = options
  const closeButton = peerListCloseButton(page)
  const wasAlreadyOpen = await closeButton.isVisible()

  if (!wasAlreadyOpen) {
    await peerListOpenButton(page).click()
    await expect(closeButton).toBeVisible()
  }

  const peerName = page.getByText(peerUserId, {
    exact: true,
  })

  await expect(peerName.first()).toBeVisible({
    timeout: 45_000,
  })

  if (!wasAlreadyOpen && !keepPeerListOpen) {
    await closeButton.click()
    await expect(closeButton).toBeHidden()
  }
}

/**
 * Prove one-way application traffic, not merely tracker WebSocket creation.
 */
export const waitForPeerMessage = async (
  sender: Page,
  receiver: Page,
  message: string
): Promise<void> => {
  await sendMessage(sender, message)

  await expect(messageLocator(receiver, message)).toBeVisible({
    timeout: 25_000,
  })
}

/**
 * Prove that both peers have a functioning bidirectional data-channel path.
 */
export const waitForBidirectionalPeerTraffic = async (
  firstPeer: Page,
  secondPeer: Page,
  label: string
): Promise<void> => {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`

  await waitForPeerMessage(
    firstPeer,
    secondPeer,
    `${label}-first-to-second-${nonce}`
  )

  await waitForPeerMessage(
    secondPeer,
    firstPeer,
    `${label}-second-to-first-${nonce}`
  )
}
