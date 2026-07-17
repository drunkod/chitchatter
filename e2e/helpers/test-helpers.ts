import { Page, expect } from '@playwright/test'

export interface JoinedRoom {
  roomUrl: string
  userId: string
}

export const getCurrentUserId = async (page: Page): Promise<string> => {
  const username = page.getByText(/Your username:/)

  await expect(username).toBeVisible()
  const text = await username.textContent()
  const userId = text?.replace(/^.*Your username:\s*/, '').trim()

  if (!userId) {
    throw new Error('Could not read the generated Chitchatter username')
  }

  return userId
}

export const joinPublicRoom = async (page: Page): Promise<JoinedRoom> => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const userId = await getCurrentUserId(page)

  await page
    .getByRole('button', {
      name: /join public room/i,
    })
    .click()
  await page.waitForURL(/\/public\/.+/)
  await expect(page.getByPlaceholder('Your message').first()).toBeVisible()

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
  await page.waitForLoadState('networkidle')

  const userId = await getCurrentUserId(page)

  await page.goto(roomUrl)
  await page.waitForLoadState('networkidle')
  await expect(page.getByPlaceholder('Your message').first()).toBeVisible()

  return userId
}

/**
 * Helper function to send a message in a room
 */
export const sendMessage = async (
  page: Page,
  message: string
): Promise<void> => {
  const chatInput = page.getByPlaceholder('Your message').first()

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
  })

  if (!(await closePeerListButton.isVisible())) {
    await page.getByRole('button', { name: 'Peer list' }).click()
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
