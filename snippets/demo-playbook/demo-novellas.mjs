// Target: snippets/demo-playbook/demo-novellas.mjs (replace)
//
// Rewritten against the CURRENT codebase:
//   - two-step gateway (Choose <Novella> → Choose <Role>)
//   - per-novella stage rooms from config/duets.ts
//   - host-only ICE via demo-server.mjs (VITE_IS_E2E_TEST)
//
// Connection recipe copied from the PASSING classic suite:
//   1. Player A enters and is given an announce window before B joins.
//   2. BOTH sides must show a real peer before ANY message is sent —
//      chitchatter delivers only to peers connected at send time, so an
//      early send is dropped forever.
//   3. Probes are re-sent until delivered.
//
// Run from the repo root:
//   node snippets/demo-playbook/demo-novellas.mjs             # all four
//   node snippets/demo-playbook/demo-novellas.mjs masquerade  # just one
//   HEADED=1 node snippets/demo-playbook/demo-novellas.mjs    # watch it

import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chromium } from '@playwright/test'

import { isHeaded, repoRoot, startDemoServer } from './demo-server.mjs'

const outDir = resolve(repoRoot, 'demo-output')
const ANNOUNCE_WINDOW_MS = 4_000

// Mirrors src/config/duets.ts + the bundled story.json files.
const NOVELLAS = [
  {
    id: 'two-lanterns',
    title: 'Two Lanterns',
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
    roles: ['Ink', 'Echo'],
    opening:
      "A sheet of paper, half-filled, ends mid-sentence: 'She opened the door and—'",
    afterContinue: 'Ink decides what happens. Echo decides what it means.',
    choice: 'Write the storm in',
    afterChoice:
      '—the rain came in sideways, and the candles went out all at once.',
  },
]

const novellaOf = page => page.getByRole('region', { name: 'Novella' })
const messageInput = page => page.getByPlaceholder('Your message').first()
const peerListOpen = page =>
  page.getByRole('button', { name: 'Peer list', exact: true })
const peerListClose = page =>
  page.getByRole('button', { name: 'Close peer list', exact: true })

const waitFor = async (locator, timeout = 45_000) =>
  locator.waitFor({ state: 'visible', timeout })

const waitForRoomReady = async page => waitFor(messageInput(page), 30_000)

// PeerList always renders a SELF ListItem, so counting listitems is a false
// positive. "Searching for peers..." renders iff peerList.length === 0 —
// its absence is the only self-proof signal.
const waitForPartner = async (page, label) => {
  if (!(await peerListClose(page).isVisible())) {
    await peerListOpen(page).click()
    await waitFor(peerListClose(page), 15_000)
  }

  await page
    .getByText('Searching for peers...')
    .waitFor({ state: 'hidden', timeout: 90_000 })
  console.log(`  [peer] ${label}: partner connected`)

  await peerListClose(page).click()
  await peerListClose(page).waitFor({ state: 'hidden', timeout: 15_000 })
}

const enterViaGateway = async (page, novella, roleTitle) => {
  await page.goto('http://localhost:3000')
  await page.getByRole('button', { name: `Choose ${novella.title}` }).click()
  await page.getByRole('button', { name: `Choose ${roleTitle}` }).click()
  await page.waitForURL(new RegExp(`/public/${novella.id}-stage-\\d+`), {
    timeout: 15_000,
  })
  await waitForRoomReady(page)

  return page.url()
}

const actFromTurnHolder = async (pages, buttonName) => {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    for (const page of pages) {
      const button = novellaOf(page).getByRole('button', {
        name: buttonName,
        exact: true,
      })

      if ((await button.count()) > 0 && (await button.isEnabled())) {
        await button.click()

        return
      }
    }

    await pages[0].waitForTimeout(500)
  }

  throw new Error(`No page had an enabled "${buttonName}" button`)
}

const runNovella = async (browser, novella) => {
  console.log(`\n[${novella.id}] ── ${novella.title} ──`)

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()

  try {
    const a = await contextA.newPage()
    const b = await contextB.newPage()

    const roomUrl = await enterViaGateway(a, novella, novella.roles[0])
    console.log(`  [room] ${roomUrl}`)

    // Announce window: let A register with the tracker before B arrives.
    await a.waitForTimeout(ANNOUNCE_WINDOW_MS)

    await enterViaGateway(b, novella, novella.roles[1])

    // Both players compute the same bucket, but if a rollover split them,
    // put B in A's exact room.
    if (b.url() !== roomUrl) {
      console.log('  [room] bucket rollover — joining A directly')
      await b.goto(roomUrl)
      await waitForRoomReady(b)
    }

    await waitForPartner(a, novella.roles[0])
    await waitForPartner(b, novella.roles[1])

    // Auto-start (no click): the story begins once both are present.
    await waitFor(novellaOf(a).getByText(novella.opening))
    await waitFor(novellaOf(b).getByText(novella.opening))
    console.log('  [story] auto-started on both sides')

    await a.screenshot({
      path: resolve(outDir, `novella-${novella.id}-started.png`),
      fullPage: true,
    })

    await actFromTurnHolder([a, b], 'Continue')
    await waitFor(novellaOf(a).getByText(novella.afterContinue))
    await waitFor(novellaOf(b).getByText(novella.afterContinue))
    console.log('  [story] beat advanced and synced')

    await actFromTurnHolder([a, b], novella.choice)
    await waitFor(novellaOf(a).getByText(novella.afterChoice))
    await waitFor(novellaOf(b).getByText(novella.afterChoice))
    console.log(`  [story] branch "${novella.choice}" resolved — PASS`)

    await b.screenshot({
      path: resolve(outDir, `novella-${novella.id}-ending.png`),
      fullPage: true,
    })
  } finally {
    await contextA.close()
    await contextB.close()
  }
}

const run = async () => {
  await mkdir(outDir, { recursive: true })

  const only = process.argv[2]
  const targets = only ? NOVELLAS.filter(n => n.id === only) : NOVELLAS

  if (targets.length === 0) {
    throw new Error(
      `Unknown novella "${only}". Options: ${NOVELLAS.map(n => n.id).join(', ')}`
    )
  }

  const server = await startDemoServer({ VITE_DUET_MODE: 'true' })
  const browser = await chromium.launch({
    headless: !isHeaded,
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
  })

  try {
    for (const novella of targets) {
      await runNovella(browser, novella)
    }

    console.log(`\nAll novellas PASS — screenshots in ${outDir}`)
  } finally {
    await browser.close()
    await server.stop()
  }
}

run().catch(error => {
  console.error('FAIL:', error)
  process.exit(1)
})
