// tests/helpers/stub-health.mjs — minimal health-only server (child process).
// Prints "LISTENING <port>" when ready.

import http from 'node:http'

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
})
server.listen(0, '127.0.0.1', () => {
  console.log(`LISTENING ${server.address().port}`)
})
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
