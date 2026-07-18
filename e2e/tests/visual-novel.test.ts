import { BrowserContext, Page, expect, test } from '@playwright/test'

import {
  joinExistingRoom,
  joinPublicRoom,
  waitForBidirectionalPeerTraffic,
  waitForPeerConnected,
  waitForRoomReady,
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
      const { roomUrl, userId: controllerUserId } =
        await joinPublicRoom(controller)

      participantContext = await browser.newContext()
      const participant = await participantContext.newPage()
      const participantUserId = await joinExistingRoom(participant, roomUrl)

      await waitForPeerConnected(controller, participantUserId)
      await waitForPeerConnected(participant, controllerUserId)
      await waitForBidirectionalPeerTraffic(
        controller,
        participant,
        'novella-ready'
      )

      await expect(novella(controller)).toBeVisible()
      await expect(novella(participant)).toBeVisible()

      await controller
        .getByRole('button', {
          name: 'Start story',
          exact: true,
        })
        .click()

      await expectDialogue(
        controller,
        'The harbour beacon is dark, and the fishing boat is still outside the breakwater.'
      )
      await expectDialogue(
        participant,
        'The harbour beacon is dark, and the fishing boat is still outside the breakwater.'
      )

      // Beacon branch
      await participant
        .getByRole('button', {
          name: 'Continue',
          exact: true,
        })
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
        .getByRole('button', {
          name: 'Light the old beacon',
          exact: true,
        })
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
        .getByRole('button', {
          name: 'Continue',
          exact: true,
        })
        .click()

      await expectDialogue(
        controller,
        'The boat answers with two flashes. They found the channel.'
      )
      await expectDialogue(
        participant,
        'The boat answers with two flashes. They found the channel.'
      )

      // Restart and test dawn branch
      await controller
        .getByRole('button', {
          name: 'Read again',
          exact: true,
        })
        .click()

      await expectDialogue(
        controller,
        'The harbour beacon is dark, and the fishing boat is still outside the breakwater.'
      )
      await expectDialogue(
        participant,
        'The harbour beacon is dark, and the fishing boat is still outside the breakwater.'
      )

      await participant
        .getByRole('button', {
          name: 'Continue',
          exact: true,
        })
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
        .getByRole('button', {
          name: 'Wait together for dawn',
          exact: true,
        })
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
        .getByRole('button', {
          name: 'Continue',
          exact: true,
        })
        .click()

      await expectDialogue(controller, 'Slowly, the boat follows it home.')
      await expectDialogue(participant, 'Slowly, the boat follows it home.')

      await controller.getByRole('button', { name: 'toggle camera' }).click()
      await expect(controller.locator('.RoomVideoDisplay')).toBeVisible({
        timeout: 15_000,
      })
      await expect(novella(controller)).toBeVisible()

      await waitForPeerConnected(controller, participantUserId, {
        keepPeerListOpen: true,
      })
      const participantListItem = controller.getByRole('listitem').filter({
        has: controller.getByText(participantUserId, { exact: true }),
      })

      await participantListItem
        .getByText(participantUserId, { exact: true })
        .click()

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

      const { roomUrl, userId: controllerUserId } =
        await joinPublicRoom(controller)

      await expect(novella(controller)).toBeVisible()

      await controller
        .getByRole('button', {
          name: 'Start story',
          exact: true,
        })
        .click()

      await controller
        .getByRole('button', {
          name: 'Continue',
          exact: true,
        })
        .click()

      await controller
        .getByRole('button', {
          name: 'Light the old beacon',
          exact: true,
        })
        .click()

      await expectDialogue(
        controller,
        'The lens catches, then floods the water with gold.'
      )

      participantContext = await browser.newContext()
      const participant = await participantContext.newPage()

      const participantUserId = await joinExistingRoom(participant, roomUrl)

      await waitForPeerConnected(controller, participantUserId)
      await waitForPeerConnected(participant, controllerUserId)

      await waitForBidirectionalPeerTraffic(
        controller,
        participant,
        'late-join-ready'
      )

      await expectDialogue(
        participant,
        'The lens catches, then floods the water with gold.'
      )

      await test.step(
        'participant reloads and establishes a new working peer connection',
        async () => {
          await participant.reload({
            waitUntil: 'domcontentloaded',
          })

          await waitForRoomReady(participant)
          await waitForPeerConnected(participant, controllerUserId)

          // The user-facing identity persists across refresh. Unique messages in
          // both directions prove that the refreshed page has a live transport.
          await waitForBidirectionalPeerTraffic(
            participant,
            controller,
            'refresh-recovery-ready'
          )

          await expectDialogue(
            participant,
            'The lens catches, then floods the water with gold.'
          )
        }
      )

      await controllerContext.close()
      controllerContext = undefined

      await expect(
        novella(participant).getByText(
          'The storyteller left. The story is paused.'
        )
      ).toBeVisible({
        timeout: 25_000,
      })

      await participant
        .getByRole('button', {
          name: 'Continue the story',
          exact: true,
        })
        .click()

      await expect(
        novella(participant).getByText('Storyteller', {
          exact: true,
        })
      ).toBeVisible()

      await participant
        .getByRole('button', {
          name: 'Continue',
          exact: true,
        })
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
