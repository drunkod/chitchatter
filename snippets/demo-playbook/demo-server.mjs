// Target: snippets/demo-playbook/demo-server.mjs (replace)
//
// KEY FIX — this is why the two-peer demos could never connect:
//
// Room.tsx line ~91 does `...(import.meta.env.VITE_IS_E2E_TEST && {
// rtcConfig: { iceServers: [] } })`. With that flag set, the app uses
// HOST-CANDIDATE-ONLY ICE, which pairs instantly between two local
// contexts on loopback. `scripts/start-e2e.mjs` sets it — that is the real
// reason the classic Playwright suite connects (headless, no display).
//
// This launcher previously omitted it, so the demos fetched a TURN config,
// showed "Relay server is unavailable", and ICE never completed. The
// display/headed-mode theory was a red herring: Playwright's Chromium does
// WebRTC fine headless, as the classic suite proves every run.
//
// Requires the minimalMode.ts change in this folder (explicit
// VITE_MINIMAL_MODE=true must win under E2E) and the duets.ts flag change
// (explicit VITE_DUET_MODE=true must win under E2E).

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '..', '..')

// Headless by default (fast, works without a display). HEADED=1 to watch.
export const isHeaded = process.env.HEADED === '1'

const isWindows = process.platform === 'win32'
const bin = name =>
  resolve(repoRoot, 'node_modules', '.bin', isWindows ? `${name}.cmd` : name)

const children = []

const launch = (command, args, env = {}) => {
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })

  children.push(child)

  return child
}

const waitForHttp = async (url, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)

      if (response.ok) return
    } catch {
      // Not up yet.
    }

    await new Promise(r => setTimeout(r, 500))
  }

  throw new Error(`Timed out waiting for ${url}`)
}

/**
 * Start Vite + tracker with the given VITE_* flags.
 * @param {Record<string, string>} viteEnv e.g. { VITE_DUET_MODE: 'true' }
 */
export const startDemoServer = async (viteEnv = {}) => {
  console.log('[demo-server] starting tracker on :8000 and Vite on :3000…')

  launch(bin('bittorrent-tracker'), []) // ws://localhost:8000

  launch(bin('vite'), ['--port', '3000', '--logLevel', 'error'], {
    VITE_TRACKER_URL: 'ws://localhost:8000',
    VITE_ENABLE_NOVELLA: 'true',
    // THE FIX: host-only ICE. Without this, local peers never pair.
    VITE_IS_E2E_TEST: 'true',
    ...viteEnv,
  })

  await waitForHttp('http://localhost:3000')
  console.log('[demo-server] ready.')

  return {
    stop: async () => {
      for (const child of children) {
        try {
          child.kill('SIGTERM')
        } catch {
          // Already gone.
        }
      }

      await new Promise(r => setTimeout(r, 2000))

      for (const child of children) {
        if (child.exitCode === null) {
          try {
            child.kill('SIGKILL')
          } catch {
            // Already gone.
          }
        }
      }
    },
  }
}
