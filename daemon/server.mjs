// daemon/server.mjs — jev-routerd loopback proxy core.
// Intercepts POST /v1/messages when body.model ∈ config.router.aliasModels,
// rewrites model + merges effort params, forwards everything to
// config.upstream.url with client auth forwarded byte-identically.
// See docs/ARCHITECTURE.md "daemon" section.

import http from 'node:http'
import https from 'node:https'
import { route, tierModel, effortParams, redacted, TIERS, EFFORTS } from '../core/index.mjs'

const VERSION = '0.1.0'
const HOP_BY_HOP = new Set(['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade'])

function lastUserText(body) {
  const messages = Array.isArray(body && body.messages) ? body.messages : []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'user') continue
    if (typeof m.content === 'string') return m.content
    if (Array.isArray(m.content)) {
      return m.content
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
    }
  }
  return ''
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function json(res, status, obj, extraHeaders = {}) {
  const payload = Buffer.from(JSON.stringify(obj))
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': payload.length, ...extraHeaders })
  res.end(payload)
}

// Forward one request upstream and pipe the response back byte-faithfully.
function forward(config, req, res, { body, jevHeaders }) {
  const upstream = new URL(config.upstream.url)
  const transport = upstream.protocol === 'https:' ? https : http
  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v // auth/x-api-key forwarded untouched, never logged
  }
  headers['content-length'] = body.length
  const upReq = transport.request(upstream, {
    method: req.method,
    path: req.url,
    headers,
    timeout: 10 * 60 * 1000, // 10-minute upstream ceiling
  }, (upRes) => {
    const responseHeaders = {}
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) responseHeaders[k] = v
    }
    Object.assign(responseHeaders, jevHeaders)
    res.writeHead(upRes.statusCode || 502, responseHeaders)
    upRes.pipe(res)
    upRes.on('error', () => res.destroy())
  })
  upReq.on('timeout', () => {
    upReq.destroy(new Error('upstream timeout after 10 minutes'))
  })
  upReq.on('error', (err) => {
    if (!res.headersSent) json(res, 502, { error: { type: 'jev_upstream_error', message: String(err && err.message || err) } }, jevHeaders)
    else res.destroy()
  })
  upReq.end(body)
}

export async function createDaemon(config) {
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return json(res, 200, { ok: true, version: VERSION, strategy: config.router.strategy })
      }
      if (req.method === 'GET' && url.pathname === '/jev/status') {
        return json(res, 200, { ok: true, version: VERSION, config: redacted(config) })
      }
      if (req.method === 'POST' && url.pathname === '/jev/route') {
        const raw = await readBody(req)
        const input = raw.length ? JSON.parse(raw.toString('utf8')) : {}
        if (typeof input.request !== 'string' || input.request.length === 0) {
          return json(res, 400, { error: 'body must be {"request": string, "context"?: object}' })
        }
        const decision = await route(input.request, input.context || {}, config)
        return json(res, 200, decision)
      }

      // Proxy path.
      const rawBody = await readBody(req)
      const isMessages = req.method === 'POST' && url.pathname === '/v1/messages'
      if (!isMessages) {
        return forward(config, req, res, { body: rawBody, jevHeaders: { 'x-jev-tier': 'passthrough', 'x-jev-effort': 'passthrough', 'x-jev-backend': 'passthrough' } })
      }

      let parsed
      try {
        parsed = JSON.parse(rawBody.toString('utf8'))
      } catch {
        return json(res, 400, { error: 'request body is not valid JSON' })
      }
      const model = parsed && parsed.model
      if (typeof model !== 'string' || !config.router.aliasModels.includes(model)) {
        return forward(config, req, res, { body: rawBody, jevHeaders: { 'x-jev-tier': 'passthrough', 'x-jev-effort': 'passthrough', 'x-jev-backend': 'passthrough' } })
      }

      // Interception: route the last user turn, rewrite model + effort.
      const decision = await route(lastUserText(parsed), {}, config)
      const nextBody = { ...parsed, model: tierModel(decision, config) }
      const effort = effortParams(decision, config)
      for (const [k, v] of Object.entries(effort)) {
        if (nextBody[k] === undefined) nextBody[k] = v // explicit client fields win
      }
      forward(config, req, res, {
        body: Buffer.from(JSON.stringify(nextBody)),
        jevHeaders: { 'x-jev-tier': decision.tier, 'x-jev-effort': decision.effort, 'x-jev-backend': decision.backend },
      })
    } catch (err) {
      if (!res.headersSent) json(res, 500, { error: { type: 'jev_error', message: String(err && err.message || err) } })
      else res.destroy()
    }
  }

  const server = http.createServer(handler)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.daemon.port, config.daemon.host, resolve)
  })
  const address = server.address()
  return {
    server,
    host: address.address,
    port: address.port,
    close: () => new Promise((r) => server.close(r)),
  }
}

export { TIERS, EFFORTS, VERSION }
