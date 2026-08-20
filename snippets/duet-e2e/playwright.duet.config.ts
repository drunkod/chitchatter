// Target: playwright.duet.config.ts (repo root, new file)
//
// Dedicated Playwright config for the duet-novella suite. Same stack as
// the classic config (start-e2e.mjs: Vite + tracker + RTC API, fast
// no-STUN WebRTC), but with VITE_DUET_MODE=true so the gateway and
// DuetNovelRoom are live. Requires the isDuetMode override from
// duets.flag.changes.md.
//
// Run:
//   npx playwright test --config=playwright.duet.config.ts --workers=1

import { defineConfig, devices } from '@playwright/test'

const isCI = Boolean(process.env.CI)
const reuseExistingServer =
  !isCI && process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === 'true'

export default defineConfig({
  testDir: './e2e/duet',
  timeout: 60 * 1000,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1, // the four suites share the same stage-room namespace
  reporter: isCI
    ? [['github'], ['html', { outputFolder: 'playwright-report-duet' }]]
    : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
    actionTimeout: 10 * 1000,
    navigationTimeout: 15 * 1000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--disable-features=WebRtcHideLocalIpsWithMdns',
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'node scripts/start-e2e.mjs',
    url: 'http://localhost:3000',
    reuseExistingServer,
    timeout: 120 * 1000,
    env: {
      IS_E2E_TEST: 'true',
      VITE_ENABLE_NOVELLA: 'true',
      VITE_DUET_MODE: 'true', // flows through start-e2e.mjs into Vite
    },
  },
})
