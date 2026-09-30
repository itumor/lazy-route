// tests/daemon.test.mjs — E2E for jev-routerd over real loopback servers.
// Mock upstream captures every request; a mock brain can replace the JEV API.

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createDaemon } from '../daemon/server.mjs'
import { DEFAULT_CONFIG } from '../core/index.mjs'

// ---- helpers ---------------------------------------------------------------

function startMockUpstream(handler) {
  const captured = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      captured.push({
        method: req.method,
        url: req.url,
        headers: { ...req.headers },
        body: Buffer.concat(chunks),
      })
      handler(req, res, captured[captured.length - 1])
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server, captured,
      port: server.address().port,
      close: () => new Promise((r) => server.close(r)),
    }))
  })
}

function baseConfig(upstreamPort) {
  const config = structuredClone(DEFAULT_CONFIG)
  config.router.strategy = 'heuristic' // deterministic, no external brain
  config.upstream.url = `http://127.0.0.1:${upstreamPort}`
  config.daemon.port = 0
  config.jev.apiKey = 'should-be-redacted'
  return config
}

async function setup(upstreamHandler, mutateConfig) {
  const upstream = await startMockUpstream(upstreamHandler)
  const config = baseConfig(upstream.port)
  if (mutateConfig) mutateConfig(config)
  const daemon = await createDaemon(config)
  return { upstream, daemon, config }
}

const jsonReply = { id: 'msg_1', type: 'message', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }

function post(daemonPort, path, body, headers = {}) {
  return fetch(`http://127.0.0.1:${daemonPort}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

// ---- tests -----------------------------------------------------------------

test('1. /health reports ok + strategy', async () => {
  const { upstream, daemon } = await setup((req, res) => { res.writeHead(200).end('{}') })
  try {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/health`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.strategy, 'heuristic')
  } finally {
    await daemon.close(); await upstream.close()
  }
})

test('2. /jev/status redacts jev.apiKey', async () => {
  const { upstream, daemon } = await setup((req, res) => { res.writeHead(200).end('{}') })
  try {
    const body = await (await fetch(`http://127.0.0.1:${daemon.port}/jev/status`)).json()
    assert.equal(body.config.jev.apiKey, '***')
    assert.equal(body.config.jev.url, 'https://api.jev.dev/v1')
  } finally {
    await daemon.close(); await upstream.close()
  }
})

test('3. POST /jev/route is a dry run — upstream never touched', async () => {
  const { upstream, daemon } = await setup((req, res) => { res.writeHead(200).end('{}') })
  try {
    const res = await post(daemon.port, '/jev/route', { request: 'fix typo in readme' })
    assert.equal(res.status, 200)
    const decision = await res.json()
    assert.equal(decision.tier, 'haiku')
    assert.equal(decision.effort, 'low')
    assert.equal(upstream.captured.length, 0)
  } finally {
    await daemon.close(); await upstream.close()
  }
})

test('4. alias model is intercepted: upstream sees concrete model + merged thinking', async () => {
  const { upstream, daemon } = await setup((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(jsonReply))
  })
  try {
    const res = await post(daemon.port, '/v1/messages', {
      model: 'jev-router',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'fix typo in readme' }],
    })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).id, 'msg_1')
    assert.equal(res.headers.get('x-jev-tier'), 'haiku')
    assert.equal(res.headers.get('x-jev-effort'), 'low')
    assert.equal(res.headers.get('x-jev-backend'), 'heuristic')

    assert.equal(upstream.captured.length, 1)
    const forwarded = JSON.parse(upstream.captured[0].body.toString('utf8'))
    assert.equal(forwarded.model, 'claude-haiku-4-5') // rewritten from jev-router
    assert.equal(forwarded.thinking.type, 'enabled')
    assert.equal(forwarded.thinking.budget_tokens, 1024) // effortParams merged
    assert.equal(forwarded.max_tokens, 100)
  } finally {
    await daemon.close(); await upstream.close()
  }
})

test('5. explicit client thinking block is never overwritten', async () => {
  const { upstream, daemon } = await setup((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(jsonReply))
  })
  try {
    await post(daemon.port, '/v1/messages', {
      model: 'jev-router',
      max_tokens: 100,
      thinking: { type: 'enabled', budget_tokens: 7777 },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello, say hi' }] }],
    })
    const forwarded = JSON.parse(upstream.captured[0].body.toString('utf8'))
    assert.equal(forwarded.thinking.budget_tokens, 7777) // client's own block wins
    assert.equal(forwarded.model, 'claude-haiku-4-5')
  } finally {
    await daemon.close(); await upstream.close()
  }
})

test('6. non-alias model passes through byte-identically', async () => {
  const { upstream, daemon } = await setup((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(jsonReply))
  })
  try {
    const payload = JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }], "odd key": ["~", 1] })
    const res = await post(daemon.port, '/v1/messages', payload)
    assert.equal(res.headers.get('x-jev-tier'), 'passthrough')
    assert.equal(upstream.captured[0].body.toString('utf8'), payload) // byte-equal
  } finally {
    await daemon.close(); await upstream.close()
  }
})

test('7. SSE streaming passthrough is byte-identical', async () => {
  const sseBytes = [
    'event: message_start\ndata: {"type":"message_start"}\n\n',
    'data: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ]
  const { upstream, daemon } = await setup((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    let i = 0
    const tick = () => {
      if (i >= sseBytes.length) return res.end()
      res.write(sseBytes[i++])
      setTimeout(tick, 40)
    }
    tick()
  })
  try {
    const res = await post(daemon.port, '/v1/messages', {
      model: 'claude-sonnet-4-5', stream: true, max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'text/event-stream')
    const received = await res.text()
    assert.equal(received, sseBytes.join(''))
  } finally {
    await daemon.close(); await upstream.close()
  }
})

test('8. authorization and x-api-key forwarded byte-identically', async () => {
  const { upstream, daemon } = await setup((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(jsonReply))
  })
  try {
    const auth = 'Bearer sk-ant-oat01-SECRET-more-secret'
    const apiKey = 'sk-ant-api03-ANOTHERSECRET'
    await post(daemon.port, '/v1/messages', {
      model: 'jev-router', max_tokens: 5,
      messages: [{ role: 'user', content: 'hi' }],
    }, { authorization: auth, 'x-api-key': apiKey })
    assert.equal(upstream.captured[0].headers.authorization, auth)
    assert.equal(upstream.captured[0].headers['x-api-key'], apiKey)
  } finally {
    await daemon.close(); await upstream.close()
  }
})

test('9. brain unreachable → chain fallback still serves, x-jev-backend=heuristic', async () => {
  const { upstream, daemon, } = await setup((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(jsonReply))
  }, (config) => {
    config.router.strategy = 'chain'
    config.jev.url = 'http://127.0.0.1:1/v1' // closed
    config.jev.timeoutMs = 1200
  })
  try {
    const res = await post(daemon.port, '/v1/messages', {
      model: 'jev-router', max_tokens: 5,
      messages: [{ role: 'user', content: 'fix typo in readme' }],
    })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-jev-backend'), 'heuristic')
    assert.equal(res.headers.get('x-jev-tier'), 'haiku')
    assert.equal(upstream.captured.length, 1)
  } finally {
    await daemon.close(); await upstream.close()
  }
})

test('10. non-/v1/messages paths pass through (GET /v1/models)', async () => {
  const { upstream, daemon } = await setup((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'claude-sonnet-4-5' }] }))
  })
  try {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/v1/models`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-jev-tier'), 'passthrough')
    const body = await res.json()
    assert.equal(body.data[0].id, 'claude-sonnet-4-5')
    assert.equal(upstream.captured[0].method, 'GET')
    assert.equal(upstream.captured[0].url, '/v1/models')
  } finally {
    await daemon.close(); await upstream.close()
  }
})

test('11. routed brain via local OpenAI-compatible URL (local-model override works)', async () => {
  // Mock "ollama-like" brain answering the questionnaire with sonnet-ish signals
  const brain = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const parsed = JSON.parse(body)
      assert.equal(parsed.model, 'qwen3:8b')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '{"signals":{"task_complexity":0.55,"tool_complexity":0.5,"execution_depth":0.5,"verification_difficulty":0.5,"specialized_expertise":0.5,"planning_required":0.55,"requires_tools":true},"confidence":0.8,"reason":"standard production coding via local brain"}' } }] }))
    })
  })
  await new Promise((r) => brain.listen(0, '127.0.0.1', r))
  const brainPort = brain.address().port
  const { upstream, daemon } = await setup((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(jsonReply))
  }, (config) => {
    config.router.strategy = 'jev'
    config.jev.url = `http://127.0.0.1:${brainPort}/v1`
    config.jev.model = 'qwen3:8b'
    config.jev.apiKey = ''
  })
  try {
    const res = await post(daemon.port, '/v1/messages', {
      model: 'jev-router', max_tokens: 5,
      messages: [{ role: 'user', content: 'implement caching for the orders page' }],
    })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-jev-backend'), 'jev')
    assert.equal(res.headers.get('x-jev-tier'), 'sonnet')
    const forwarded = JSON.parse(upstream.captured[0].body.toString('utf8'))
    assert.equal(forwarded.model, 'claude-sonnet-5-5')
    assert.equal(forwarded.thinking.budget_tokens, 4096) // medium effort from the brain's signals
  } finally {
    await daemon.close(); await upstream.close(); brain.close()
  }
})

test('12. invalid JSON body on alias path → 400, no upstream hit', async () => {
  const { upstream, daemon } = await setup((req, res) => { res.writeHead(200).end('{}') })
  try {
    const res = await post(daemon.port, '/v1/messages', '{not json')
    assert.equal(res.status, 400)
    assert.equal(upstream.captured.length, 0)
  } finally {
    await daemon.close(); await upstream.close()
  }
})

test('13. injected <system-reminder> blocks are ignored when routing (real claude 2.1.284 shape)', async () => {
  const { upstream, daemon } = await setup((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(jsonReply))
  })
  try {
    const reminder = '<system-reminder>\n# Environment\n - This is a git worktree. Never use bare git stash / git stash pop; prefer a temporary WIP commit, restore with git stash apply <sha>, then drop the entry.\n</system-reminder>'
    const res = await post(daemon.port, '/v1/messages', {
      model: 'jev-router',
      max_tokens: 100,
      messages: [{ role: 'user', content: [
        { type: 'text', text: reminder },
        { type: 'text', text: '<system-reminder>Available agent types: Explore, Plan, security-auditor, code-reviewer</system-reminder>' },
        { type: 'text', text: 'say hi' },
      ] }],
    })
    assert.equal(res.headers.get('x-jev-tier'), 'haiku') // routed on "say hi", not on the reminders
    assert.equal(JSON.parse(upstream.captured[0].body.toString('utf8')).model, 'claude-haiku-4-5')
  } finally {
    await daemon.close(); await upstream.close()
  }
})
