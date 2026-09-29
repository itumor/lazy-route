// tests/core.test.mjs — multi-case E2E for the JEV core engine.
// All network in tests is loopback-only (127.0.0.1:0).

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import {
  route, heuristicRoute, jevRoute, loadConfig, tierModel, effortParams,
  describeDecision, DEFAULT_CONFIG, TIERS, EFFORTS, redacted,
} from '../core/index.mjs'

const TRADING_PROMPT = 'Act as the lead architect and autonomous engineering agent for a highly complex production trading platform. First, perform full requirements gathering with the customer, identify functional and non-functional requirements, clarify ambiguities, uncover hidden constraints, define success criteria, and document risks and assumptions. Then design and build the entire system from A to Z, including architecture, services, APIs, data models, authentication, market-data ingestion, order management, execution logic, portfolio and position management, risk controls, backtesting, observability, CI/CD, infrastructure, security, disaster recovery, testing, deployment, and operational runbooks. The work requires sustained reasoning over many dependent steps, continuous state tracking, repeated tool interaction, architecture trade-offs, implementation, validation, debugging, failure recovery, and replanning when assumptions or intermediate results change. Continue until the platform is production-ready and validated end-to-end.'

test('1. trivial prompt routes haiku + low', () => {
  const d = heuristicRoute('fix typo in readme')
  assert.equal(d.tier, 'haiku')
  assert.equal(d.effort, 'low')
  assert.equal(d.backend, 'heuristic')
  assert.ok(d.confidence >= 0.5 && d.confidence <= 0.99)
})

test('2. normal coding task routes sonnet', () => {
  const d = heuristicRoute('Implement a paginated orders endpoint in the Express API with input validation, then add unit tests for the edge cases and fix the flaky test in the CI pipeline.')
  assert.equal(d.tier, 'sonnet')
  assert.ok(['low', 'medium', 'high'].includes(d.effort))
})

test('3. trading platform prompt routes fable + xhigh/max', () => {
  const d = heuristicRoute(TRADING_PROMPT)
  assert.equal(d.tier, 'fable')
  assert.ok(['xhigh', 'max'].includes(d.effort))
  assert.equal(d.signals.high_stakes, true)
  assert.equal(d.signals.long_horizon, true)
  assert.ok(d.signals.execution_depth >= 0.7)
})

test('4. explicit context.signals override forces haiku on scary text', () => {
  const d = heuristicRoute('DELETE the entire production database for the trading platform, end-to-end autonomous disaster recovery', {
    signals: { task_complexity: 0.05, execution_depth: 0.05, novelty: 0, specialized_expertise: 0.05 },
  })
  assert.ok(d.signals.task_complexity <= 0.1)
  // high_stakes keyword still wins the floor — overrides change scores, not safety rails
  assert.equal(d.signals.high_stakes, true)
  assert.ok(TIERS.indexOf(d.tier) >= TIERS.indexOf('opus'))
})

test('5. high-stakes keywords lift trivial wording to opus floor', () => {
  const d = heuristicRoute('delete production database')
  assert.ok(TIERS.indexOf(d.tier) >= TIERS.indexOf('opus'))
})

test('6. env overrides: JEV_API_URL, JEV_PORT, JEV_TIER_OPUS', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'jev-core-'))
  const config = await loadConfig({}, {
    JEV_API_URL: 'http://localhost:11434/v1',
    JEV_PORT: '4000',
    JEV_TIER_OPUS: 'claude-opus-999',
  }, home)
  assert.equal(config.jev.url, 'http://localhost:11434/v1')
  assert.equal(config.daemon.port, 4000)
  assert.equal(config.tiers.opus, 'claude-opus-999')
  assert.equal(config.tiers.haiku, DEFAULT_CONFIG.tiers.haiku) // untouched default
})

test('7. config file merges over defaults, env beats file', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'jev-core-'))
  const configDir = path.join(home, '.jev')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(path.join(configDir, 'router.json'), JSON.stringify({
    jev: { url: 'http://file-url/v1', model: 'file-model' },
    router: { strategy: 'heuristic' },
    daemon: { port: 1111 },
  }))
  const config = await loadConfig({}, { JEV_API_URL: 'http://env-url/v1' }, home)
  assert.equal(config.jev.url, 'http://env-url/v1') // env wins
  assert.equal(config.jev.model, 'file-model')      // file wins over default
  assert.equal(config.router.strategy, 'heuristic')
  assert.equal(config.daemon.port, 1111)
})

test('8. tierModel and effortParams obey config and deep-clone', () => {
  const config = structuredClone(DEFAULT_CONFIG)
  config.tiers.opus = 'claude-opus-x'
  assert.equal(tierModel({ tier: 'opus' }, config), 'claude-opus-x')
  const params = effortParams({ effort: 'high' }, config)
  assert.deepEqual(params, { thinking: { type: 'enabled', budget_tokens: 16384 } })
  params.thinking.budget_tokens = 1
  assert.equal(config.effortMap.high.thinking.budget_tokens, 16384) // not mutated
})

test('9. jevRoute parses a mock OpenAI-compatible brain reply', async (t) => {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      assert.equal(req.url, '/v1/chat/completions')
      assert.equal(req.headers.authorization, 'Bearer test-key')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        choices: [{ message: { content: 'Here is my analysis:\n{"signals":{"task_complexity":0.95,"execution_depth":0.9,"long_horizon":true,"high_stakes":true,"specialized_expertise":0.9,"planning_required":0.95,"novelty":0.85},"confidence":0.93,"reason":"frontier long-horizon platform build"}' } }],
      }))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const port = server.address().port
    const config = structuredClone(DEFAULT_CONFIG)
    config.jev.url = `http://127.0.0.1:${port}/v1`
    config.jev.apiKey = 'test-key'
    config.jev.model = 'mock-brain'
    const d = await jevRoute(TRADING_PROMPT, {}, config)
    assert.equal(d.tier, 'fable')
    assert.equal(d.effort, 'max') // tierIndex 3 + depth + horizon, clamped
    assert.equal(d.backend, 'jev')
    assert.equal(d.confidence, 0.93)
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('10. chain strategy falls back to heuristic when brain unreachable', async () => {
  const config = structuredClone(DEFAULT_CONFIG)
  config.jev.url = 'http://127.0.0.1:1/v1' // closed port
  config.jev.timeoutMs = 1500
  config.router.strategy = 'chain'
  const d = await route('fix typo in readme', {}, config)
  assert.equal(d.backend, 'heuristic')
  assert.equal(d.strategy, 'chain')
  assert.equal(d.tier, 'haiku')
  assert.match(d.reason, /brain unavailable/)
})

test('11. chain strategy prefers the brain when reachable', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: '{"signals":{"task_complexity":0.9,"planning_required":0.9},"confidence":0.8,"reason":"complex"}' } }] }))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const config = structuredClone(DEFAULT_CONFIG)
    config.jev.url = `http://127.0.0.1:${server.address().port}/v1`
    config.router.strategy = 'chain'
    const d = await route(TRADING_PROMPT, {}, config)
    assert.equal(d.backend, 'jev')
    assert.equal(d.strategy, 'chain')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('12. describeDecision renders a readable multi-line report', () => {
  const text = describeDecision(heuristicRoute('hello world'))
  assert.match(text, /JEV Routing Decision/)
  assert.match(text, /Tier\s+haiku/)
  assert.match(text, /Signals/)
})

test('13. redacted() hides api keys from status surfaces', () => {
  const config = structuredClone(DEFAULT_CONFIG)
  config.jev.apiKey = 'super-secret'
  const safe = redacted(config)
  assert.equal(safe.jev.apiKey, '***')
  assert.equal(config.jev.apiKey, 'super-secret')
})

test('14. bad strategy in config is rejected', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'jev-core-'))
  await assert.rejects(() => loadConfig({}, { JEV_STRATEGY: 'bogus' }, home), /strategy/)
})

test('15. malformed config file produces a clear error', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'jev-core-'))
  const { mkdirSync } = await import('node:fs')
  mkdirSync(path.join(home, '.jev'), { recursive: true })
  writeFileSync(path.join(home, '.jev', 'router.json'), '{oops')
  await assert.rejects(() => loadConfig({}, {}, home), /not valid JSON/)
})

test('16. effort ladder: low/light vs frontier-heavy inputs', () => {
  const trivial = heuristicRoute('what is 2+2?')
  const heavy = heuristicRoute(TRADING_PROMPT)
  assert.ok(EFFORTS.indexOf(trivial.effort) < EFFORTS.indexOf(heavy.effort))
})
