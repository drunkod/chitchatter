import { createServer } from 'turn-server'

const host = '127.0.0.1'
const port = 3478
const username = 'chitchatter-e2e'
const credential = 'local-test-only'
const realm = 'chitchatter-e2e'

const server = createServer({
  auth: {
    mechanism: 'long-term',
    realm,
    credentials: {
      [username]: credential,
    },
  },
  relay: {
    ip: host,
    externalIp: host,
    portRange: [49152, 65535],
  },
  allowLoopback: true,
})

let shuttingDown = false

const reportedNonFatalNetworkErrors = new Set()

const shutdown = exitCode => {
  if (shuttingDown) return

  shuttingDown = true
  server.stop(() => process.exit(exitCode))
}

server.on('error', error => {
  const nonFatalNetworkErrors = new Set([
    'EADDRNOTAVAIL',
    'EHOSTUNREACH',
    'ENETUNREACH',
  ])

  if (nonFatalNetworkErrors.has(error.code)) {
    if (!reportedNonFatalNetworkErrors.has(error.code)) {
      reportedNonFatalNetworkErrors.add(error.code)
      console.warn(
        `[e2e:turn] Ignoring unreachable ICE candidate: ${error.code}`
      )
    }

    return
  }

  console.error('[e2e:turn] Server error:', error)
  shutdown(1)
})

server.listen([{ address: host, port, transport: 'udp' }], () => {
  console.log(`[e2e:turn] Listening on turn:${host}:${port}?transport=udp`)
})

process.once('SIGINT', () => shutdown(130))
process.once('SIGTERM', () => shutdown(143))
process.once('SIGHUP', () => shutdown(129))
