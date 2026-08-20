import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptsDirectory, '..')
const packageJson = JSON.parse(
  await readFile(resolve(repositoryRoot, 'package.json'), 'utf8')
)

const isWindows = process.platform === 'win32'
const npmCommand = isWindows ? 'npm.cmd' : 'npm'
const localExecutable = name =>
  resolve(
    repositoryRoot,
    'node_modules',
    '.bin',
    isWindows ? `${name}.cmd` : name
  )
const children = new Map()

let shuttingDown = false

const launch = (name, command, args, extraEnvironment = {}) => {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnvironment,
    },

    // Keep every service in Playwright's process tree. Detached children can
    // survive an interrupted test run and leave the E2E ports occupied.
    detached: false,
  })

  children.set(name, child)

  child.once('exit', (code, signal) => {
    children.delete(name)

    if (shuttingDown) {
      return
    }

    const reason =
      signal !== null ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`

    console.error(`[start:e2e] ${name} stopped unexpectedly: ${reason}`)

    const exitCode = code !== null && code !== 0 ? code : 1
    void shutdown(exitCode)
  })

  return child
}

const signalProcessTree = (child, signal) => {
  if (!child.pid || child.exitCode !== null) {
    return
  }

  try {
    child.kill(signal)
  } catch {
    // The process may have exited between the guard and the signal.
  }
}

const delay = milliseconds =>
  new Promise(resolvePromise => {
    setTimeout(resolvePromise, milliseconds)
  })

const shutdown = async exitCode => {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  const runningChildren = [...children.values()]

  for (const child of runningChildren) {
    signalProcessTree(child, 'SIGTERM')
  }

  await Promise.race([
    Promise.all(
      runningChildren.map(child =>
        child.exitCode !== null ? Promise.resolve() : once(child, 'exit')
      )
    ),
    delay(5000),
  ])

  for (const child of runningChildren) {
    if (child.exitCode === null) {
      signalProcessTree(child, 'SIGKILL')
    }
  }

  process.exit(exitCode)
}

process.once('SIGINT', () => {
  void shutdown(130)
})

process.once('SIGTERM', () => {
  void shutdown(143)
})

process.once('SIGHUP', () => {
  void shutdown(129)
})

const commonEnvironment = {
  IS_E2E_TEST: 'true',
}

launch('RTC API', process.execPath, ['simple-api-server.js'], commonEnvironment)
launch(
  'TURN relay',
  process.execPath,
  ['scripts/start-e2e-turn.mjs'],
  commonEnvironment
)

launch(
  'WebTorrent tracker',
  isWindows ? npmCommand : localExecutable('bittorrent-tracker'),
  isWindows ? ['run', 'start:tracker'] : [],
  commonEnvironment
)

const viteEnv = {
  ...commonEnvironment,
  VITE_IS_E2E_TEST: 'true',
  VITE_RTC_CONFIG_ENDPOINT: '/api/get-config',
  VITE_E2E_TURN_URL: 'turn:127.0.0.1:3478?transport=udp',
  VITE_E2E_TURN_USERNAME: 'chitchatter-e2e',
  VITE_E2E_TURN_CREDENTIAL: 'local-test-only',

  // Avoid a localhost IPv4/IPv6 resolution difference in local WebRTC tests.
  VITE_TRACKER_URL: process.env.VITE_TRACKER_URL ?? 'ws://127.0.0.1:8000',

  // Preserve the value previously produced by `npm pkg get homepage`.
  VITE_HOMEPAGE: process.env.VITE_HOMEPAGE ?? packageJson.homepage,

  // Pass through Playwright config env vars for feature flags (set by playwright.duet.config.ts).
  ...(process.env.VITE_ENABLE_NOVELLA && {
    VITE_ENABLE_NOVELLA: process.env.VITE_ENABLE_NOVELLA,
  }),
  ...(process.env.VITE_DUET_MODE && {
    VITE_DUET_MODE: process.env.VITE_DUET_MODE,
  }),
}

// Debug: log which feature flags are active
const flags = {
  VITE_ENABLE_NOVELLA: process.env.VITE_ENABLE_NOVELLA ?? 'unset',
  VITE_DUET_MODE: process.env.VITE_DUET_MODE ?? 'unset',
}
console.log('[start-e2e] Feature flags from parent process:', flags)
console.log('[start-e2e] Flags passed to Vite:', {
  VITE_ENABLE_NOVELLA: viteEnv.VITE_ENABLE_NOVELLA ?? 'not passed',
  VITE_DUET_MODE: viteEnv.VITE_DUET_MODE ?? 'not passed',
})

launch(
  'Vite',
  isWindows ? npmCommand : localExecutable('vite'),
  isWindows
    ? ['exec', '--', 'vite', '--port', '3000', '--logLevel', 'error']
    : ['--port', '3000', '--logLevel', 'error'],
  viteEnv
)
