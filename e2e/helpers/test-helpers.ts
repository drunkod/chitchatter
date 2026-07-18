import { Page, expect } from '@playwright/test'

export interface JoinedRoom {
  roomUrl: string
  userId: string
}

const roomMessageInput = (page: Page) =>
  page.getByPlaceholder('Your message').first()

export const waitForRoomReady = async (page: Page): Promise<void> => {
  await expect(roomMessageInput(page)).toBeVisible({ timeout: 25_000 })
  await expect(page.getByText('Searching for servers...')).toBeHidden({
    timeout: 25_000,
  })
}

export const getCurrentUserId = async (page: Page): Promise<string> => {
  const username = page.getByText(/Your username:/)

  await expect(username).toBeVisible({ timeout: 30_000 })
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

/**
 * Helper function to send a message in a room
 */
export const sendMessage = async (
  page: Page,
  message: string
): Promise<void> => {
  const chatInput = roomMessageInput(page)

  await chatInput.fill(message)
  await chatInput.press('Enter')
  await expect(page.getByText(message).first()).toBeVisible()
}

export const waitForPeerConnected = async (
  page: Page,
  peerUserId: string
): Promise<void> => {
  const peerName = page.getByText(peerUserId, { exact: true }).first()
  const closePeerListButton = page.getByRole('button', {
    name: 'Close peer list',
    exact: true,
  })

  if (!(await closePeerListButton.isVisible())) {
    await page.getByRole('button', { name: 'Peer list', exact: true }).click()
  }

  await expect(peerName).toBeVisible({ timeout: 45_000 })
}

export const waitForPeerMessage = async (
  sender: Page,
  receiver: Page,
  message: string
): Promise<void> => {
  await sendMessage(sender, message)
  await expect(receiver.getByText(message).first()).toBeVisible({
    timeout: 25_000,
  })
}
