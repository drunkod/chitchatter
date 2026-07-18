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

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
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

    // Create a process group on macOS/Linux so shutdown can terminate npm and
    // the executable that npm launched.
    detached: process.platform !== 'win32',
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
    if (process.platform === 'win32') {
      child.kill(signal)
    } else {
      process.kill(-child.pid, signal)
    }
  } catch {
    child.kill(signal)
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

launch('WebTorrent tracker', npmCommand, ['run', 'start:tracker'], {
  ...commonEnvironment,
})

launch(
  'Vite',
  npmCommand,
  ['exec', '--', 'vite', '--port', '3000', '--logLevel', 'error'],
  {
    ...commonEnvironment,
    VITE_IS_E2E_TEST: 'true',
    VITE_RTC_CONFIG_ENDPOINT: '/api/get-config',

    // Avoid a localhost IPv4/IPv6 resolution difference in local WebRTC tests.
    VITE_TRACKER_URL: process.env.VITE_TRACKER_URL ?? 'ws://127.0.0.1:8000',

    // Preserve the value previously produced by `npm pkg get homepage`.
    VITE_HOMEPAGE: process.env.VITE_HOMEPAGE ?? packageJson.homepage,
  }
)
