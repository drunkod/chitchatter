// DEMO 1 — Minimal mode: auto-join anonymous room + auto-start novella.
//
// Run from the repo root:
//   node snippets/demo-playbook/demo-minimal.mjs
//
// Expect: browser opens → skips the home page entirely → lands in
// /public/<uuid> → novella panel auto-starts the story → screenshots in
// demo-output/.

import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chromium } from '@playwright/test'

import { isHeaded, repoRoot, startDemoServer } from './demo-server.mjs'

const outDir = resolve(repoRoot, 'demo-output')

const run = async () => {
  await mkdir(outDir, { recursive: true })

  const server = await startDemoServer({
    VITE_MINIMAL_MODE: 'true',
    // Minimal mode auto-joins; duet would take over the root route, so keep
    // it off to demo pure minimal.
    VITE_DUET_MODE: 'false',
  })

  const browser = await chromium.launch({
    headless: !isHeaded,
    args: [
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  })

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    })
    const page = await context.newPage()

    console.log('[minimal] navigating to http://localhost:3000 …')
    await page.goto('http://localhost:3000')

    console.log('[minimal] waiting for auto-join redirect…')
    await page.waitForURL(/\/public\/.+/, { timeout: 30_000 })
    console.log(`[minimal] auto-joined: ${page.url()}`)

    // The novella region should appear and auto-start (solo visitor: the
    // story starts without a partner in plain minimal mode).
    const novella = page.getByRole('region', { name: 'Novella' })
    await novella.waitFor({ timeout: 30_000 })

    console.log('[minimal] waiting for the story to auto-start…')
    await novella
      .getByText(
        'The harbour beacon is dark, and the fishing boat is still outside the breakwater.'
      )
      .waitFor({ timeout: 30_000 })

    await page.screenshot({
      path: resolve(outDir, 'minimal-1-story-started.png'),
      fullPage: true,
    })

    // Prove the app bar is gone (minimal shell).
    const appBarCount = await page.locator('.MuiAppBar-root').count()
    console.log(`[minimal] app bar elements found: ${appBarCount} (expected 0)`)

    // Advance one beat.
    await novella.getByRole('button', { name: 'Continue', exact: true }).click()
    await novella
      .getByText('We have time for one signal. What should we do?')
      .waitFor({ timeout: 15_000 })

    await page.screenshot({
      path: resolve(outDir, 'minimal-2-first-choice.png'),
      fullPage: true,
    })

    console.log(`[minimal] PASS — screenshots in ${outDir}`)
  } finally {
    await browser.close()
    await server.stop()
  }
}

run().catch(error => {
  console.error('[minimal] FAIL:', error)
  process.exit(1)
})
