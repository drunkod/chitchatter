import { BrowserContext, Page, expect, test } from '@playwright/test'

import {
  joinExistingRoom,
  joinPublicRoom,
  waitForPeerMessage,
} from '../helpers/test-helpers'

const novella = (page: Page) =>
  page.getByRole('region', {
    name: 'Novella',
  })

const expectDialogue = async (page: Page, text: string) => {
  await expect(novella(page).getByText(text)).toBeVisible({ timeout: 25_000 })
}

test.describe('Novella MVP', () => {
  test.describe.configure({ timeout: 120_000 })

  test('shares both Harbour Lights branches without regressing chat, video, or DMs', async ({
    browser,
  }) => {
    let controllerContext: BrowserContext | undefined
    let participantContext: BrowserContext | undefined

    try {
      controllerContext = await browser.newContext({
        permissions: ['camera', 'microphone'],
      })
      const controller = await controllerContext.newPage()
      const { roomUrl } = await joinPublicRoom(controller)

      participantContext = await browser.newContext()
      const participant = await participantContext.newPage()
      const participantUserId = await joinExistingRoom(participant, roomUrl)

      await waitForPeerMessage(
        controller,
        participant,
        `novella-ready-${Date.now()}`
      )

      await expect(novella(controller)).toBeVisible()
      await expect(novella(participant)).toBeVisible()

      await controller.getByRole('button', { name: 'Start story' }).click()
      await expectDialogue(
        controller,
        'The harbour beacon is dark, and the fishing boat is still outside the breakwater.'
      )
      await expectDialogue(
        participant,
        'The harbour beacon is dark, and the fishing boat is still outside the breakwater.'
      )

      await participant
        .getByRole('button', { name: 'Continue', exact: true })
        .click()
      await expectDialogue(
        controller,
        'We have time for one signal. What should we do?'
      )
      await expectDialogue(
        participant,
        'We have time for one signal. What should we do?'
      )

      await participant
        .getByRole('button', { name: 'Light the old beacon' })
        .click()
      await expectDialogue(
        controller,
        'The lens catches, then floods the water with gold.'
      )
      await expectDialogue(
        participant,
        'The lens catches, then floods the water with gold.'
      )

      await participant
        .getByRole('button', { name: 'Continue', exact: true })
        .click()
      await expectDialogue(
        controller,
        'The boat answers with two flashes. They found the channel.'
      )
      await expectDialogue(
        participant,
        'The boat answers with two flashes. They found the channel.'
      )

      await controller.getByRole('button', { name: 'Read again' }).click()
      await expectDialogue(
        participant,
        'The harbour beacon is dark, and the fishing boat is still outside the breakwater.'
      )

      await participant
        .getByRole('button', { name: 'Continue', exact: true })
        .click()
      await participant
        .getByRole('button', { name: 'Wait together for dawn' })
        .click()
      await expectDialogue(
        controller,
        'The first light draws a silver road across the water.'
      )
      await expectDialogue(
        participant,
        'The first light draws a silver road across the water.'
      )

      await participant
        .getByRole('button', { name: 'Continue', exact: true })
        .click()
      await expectDialogue(controller, 'Slowly, the boat follows it home.')
      await expectDialogue(participant, 'Slowly, the boat follows it home.')

      await controller.getByRole('button', { name: 'toggle camera' }).click()
      await expect(controller.locator('.RoomVideoDisplay')).toBeVisible({
        timeout: 15_000,
      })
      await expect(novella(controller)).toBeVisible()

      const participantName = controller
        .getByText(participantUserId, { exact: true })
        .first()

      if (!(await participantName.isVisible())) {
        await controller.getByRole('button', { name: 'Peer list' }).click()
      }

      await expect(participantName).toBeVisible({ timeout: 25_000 })
      await participantName.click()

      const directMessageDialog = controller.getByRole('dialog')

      await expect(directMessageDialog).toBeVisible()
      await expect(
        directMessageDialog.getByPlaceholder('Your message')
      ).toBeVisible()
      await expect(
        directMessageDialog.getByRole('region', { name: 'Novella' })
      ).toHaveCount(0)
    } finally {
      await controllerContext?.close()
      await participantContext?.close()
    }
  })

  test('recovers a late join and refresh, then continues after controller departure', async ({
    browser,
  }) => {
    let controllerContext: BrowserContext | undefined
    let participantContext: BrowserContext | undefined

    try {
      controllerContext = await browser.newContext()
      const controller = await controllerContext.newPage()
      const { roomUrl } = await joinPublicRoom(controller)

      await expect(novella(controller)).toBeVisible()
      await controller.getByRole('button', { name: 'Start story' }).click()
      await controller
        .getByRole('button', { name: 'Continue', exact: true })
        .click()
      await controller
        .getByRole('button', { name: 'Light the old beacon' })
        .click()
      await expectDialogue(
        controller,
        'The lens catches, then floods the water with gold.'
      )

      participantContext = await browser.newContext()
      const participant = await participantContext.newPage()

      await joinExistingRoom(participant, roomUrl)
      await expectDialogue(
        participant,
        'The lens catches, then floods the water with gold.'
      )

      await participant.reload()
      await participant.waitForLoadState('networkidle')
      await expectDialogue(
        participant,
        'The lens catches, then floods the water with gold.'
      )

      await waitForPeerMessage(
        controller,
        participant,
        `novella-refresh-ready-${Date.now()}`
      )

      await controllerContext.close()
      controllerContext = undefined

      await expect(
        novella(participant).getByText(
          'The storyteller left. The story is paused.'
        )
      ).toBeVisible({ timeout: 25_000 })
      await participant
        .getByRole('button', { name: 'Continue the story' })
        .click()

      await expect(
        novella(participant).getByText('Storyteller', { exact: true })
      ).toBeVisible()
      await participant
        .getByRole('button', { name: 'Continue', exact: true })
        .click()
      await expectDialogue(
        participant,
        'The boat answers with two flashes. They found the channel.'
      )
    } finally {
      await controllerContext?.close()
      await participantContext?.close()
    }
  })
})
