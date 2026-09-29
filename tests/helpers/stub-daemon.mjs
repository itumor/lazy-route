// tests/helpers/stub-daemon.mjs — child-process stub of jev-routerd.
// Prints "LISTENING <port>" on stdout when ready. Replies /health and a fixed
// /jev/route decision ({tier:"opus"}) like the real daemon.

import http from 'node:http'

const port = process.argv[2] ? Number(process.argv[2]) : 0
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"version":"stub"}')
  }
  if (req.url === '/jev/route' && req.method === 'POST') {
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        tier: 'opus', effort: 'high', confidence: 0.9, strategy: 'stub', backend: 'heuristic',
        signals: {}, reason: 'stub daemon',
      }))
    })
    return
  }
  res.writeHead(404).end('{}')
})
server.listen(port, '127.0.0.1', () => {
  console.log(`LISTENING ${server.address().port}`)
})
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
