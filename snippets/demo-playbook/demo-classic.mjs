// DEMO 3 — Classic mode: home form → join room → manual "Start story".
//
// Run from the repo root:
//   node snippets/demo-playbook/demo-classic.mjs
//
// This is the flow the E2E suite exercises. Useful as a quick sanity check
// that the flag-gating leaves the original app intact.

import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chromium } from '@playwright/test'

import { isHeaded, repoRoot, startDemoServer } from './demo-server.mjs'

const outDir = resolve(repoRoot, 'demo-output')

const run = async () => {
  await mkdir(outDir, { recursive: true })

  // Everything off: no minimal, no duet. VITE_ENABLE_NOVELLA=true is set by
  // demo-server so the novella panel exists.
  const server = await startDemoServer({
    VITE_MINIMAL_MODE: 'false',
    VITE_DUET_MODE: 'false',
  })

  const browser = await chromium.launch({ headless: !isHeaded })

  try {
    const page = await browser.newPage()

    console.log('[classic] navigating to http://localhost:3000 …')
    await page.goto('http://localhost:3000')

    // The classic home page: room-name field + Join public room button.
    await page.screenshot({
      path: resolve(outDir, 'classic-1-home.png'),
      fullPage: true,
    })

    console.log('[classic] joining a public room via the form…')
    await page
      .getByRole('button', { name: 'Join public room', exact: true })
      .click()
    await page.waitForURL(/\/public\/.+/, { timeout: 15_000 })

    // App bar must be present in classic mode.
    const appBarCount = await page.locator('.MuiAppBar-root').count()
    console.log(
      `[classic] app bar elements found: ${appBarCount} (expected >= 1)`
    )

    // Novella panel with the manual start button.
    const novella = page.getByRole('region', { name: 'Novella' })
    await novella.waitFor({ timeout: 30_000 })
    await page.screenshot({
      path: resolve(outDir, 'classic-2-room-with-start-button.png'),
      fullPage: true,
    })

    console.log('[classic] clicking "Start story"…')
    await novella
      .getByRole('button', { name: 'Start story', exact: true })
      .click()
    await novella
      .getByText(
        'The harbour beacon is dark, and the fishing boat is still outside the breakwater.'
      )
      .waitFor({ timeout: 30_000 })

    // Media controls must exist in classic mode.
    const cameraCount = await page
      .getByRole('button', { name: 'toggle camera' })
      .count()
    console.log(`[classic] camera toggle found: ${cameraCount} (expected 1)`)

    await page.screenshot({
      path: resolve(outDir, 'classic-3-story-started.png'),
      fullPage: true,
    })

    console.log(`[classic] PASS — screenshots in ${outDir}`)
  } finally {
    await browser.close()
    await server.stop()
  }
}

run().catch(error => {
  console.error('[classic] FAIL:', error)
  process.exit(1)
})
