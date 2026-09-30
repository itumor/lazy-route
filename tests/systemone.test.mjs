// tests/systemone.test.mjs — E2E for the System One brain backend
// (Ollama /v1/systemone: Nimble / Tev1). All network is loopback-only.

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import {
  route, systemoneRoute, loadConfig, DEFAULT_CONFIG, QUESTIONNAIRE, SIGNAL_KEYS, redacted,
} from '../core/index.mjs'

const TRADING_PROMPT = 'Act as the lead architect and autonomous engineering agent for a highly complex production trading platform. First, perform full requirements gathering with the customer, identify functional and non-functional requirements, clarify ambiguities, uncover hidden constraints, define success criteria, and document risks and assumptions. Then design and build the entire system from A to Z, including architecture, services, APIs, data models, authentication, market-data ingestion, order management, execution logic, portfolio and position management, risk controls, backtesting, observability, CI/CD, infrastructure, security, disaster recovery, testing, deployment, and operational runbooks. The work requires sustained reasoning over many dependent steps, continuous state tracking, repeated tool interaction, architecture trade-offs, implementation, validation, debugging, failure recovery, and replanning when assumptions or intermediate results change. Continue until the platform is production-ready and validated end-to-end.'

// Score answers live on a 0..3 level scale (4-level rubric); "score" is the
// probability-weighted level. 2.8/3 → signal 0.933, 0.3/3 → 0.1, etc.
function cannedAnswers() {
  const score = (v, confidence = 0.7) => ({
    type: 'score', score: v, legend: { 0: 'l0', 1: 'l1', 2: 'l2', 3: 'l3' },
    probabilities: { 0: 0.02, 1: 0.08, 2: 0.2, 3: 0.7 }, confidence,
  })
  return {
    model_tier: { type: 'choice', choice: 'fable', probabilities: { haiku: 0, sonnet: 0.02, opus: 0.17, fable: 0.81 }, confidence: 0.62 },
    effort: { type: 'choice', choice: 'xhigh', probabilities: { low: 0, medium: 0.01, high: 0.2, xhigh: 0.6, max: 0.19 }, confidence: 0.42 },
    task_complexity: score(2.8),
    ambiguity: score(0.3, 0.8),
    underspecified: { type: 'noul', noul: 0.02 },
    high_stakes: { type: 'noul', noul: 0.99 },
    requires_tools: { type: 'noul', noul: 0.98 },
    tool_complexity: score(2.5),
    execution_depth: score(2.9),
    long_horizon: { type: 'noul', noul: 0.97 },
    verification_difficulty: score(2.6),
    specialized_expertise: score(2.8),
    failure_recovery_complexity: score(2.6),
    context_complexity: score(2.5),
    planning_required: score(2.8),
    reversibility: score(0.8),
    novelty: score(2.5),
  }
}

// Stub System One server. inspect (optional) receives the parsed request body.
async function stubSystemOne(reply, inspect) {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const parsed = JSON.parse(body)
      if (inspect) inspect(parsed, req)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(typeof reply === 'function' ? reply(parsed) : reply))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return server
}

function configFor(server, patch = {}) {
  const config = structuredClone(DEFAULT_CONFIG)
  config.systemone.url = `http://127.0.0.1:${server.address().port}`
  Object.assign(config.systemone, patch)
  return config
}

test('1. systemoneRoute sends the questionnaire verbatim and maps answers to a fable decision', async () => {
  const server = await stubSystemOne({ model: 'nimble', answers: cannedAnswers(), usage: { input_tokens: 3000, output_tokens: 17 } }, (body) => {
    assert.equal(body.model, 'nimble')
    assert.equal(body.keep_alive, '10m')
    assert.equal(typeof body.state, 'string')
    assert.ok(body.state.includes('trading platform'))
    // The questionnaire goes over the wire exactly as defined — it IS the Jev question schema.
    assert.deepEqual(body.questions, JSON.parse(JSON.stringify(QUESTIONNAIRE)))
    assert.equal(Object.keys(body.questions).length, 17) // well under the 64-question cap
    assert.deepEqual(Object.keys(body.questions.model_tier.criteria), ['haiku', 'sonnet', 'opus', 'fable'])
  })
  try {
    const d = await systemoneRoute(TRADING_PROMPT, {}, configFor(server))
    assert.equal(d.tier, 'fable')   // long_horizon && execution_depth 0.97 ≥ 0.8
    assert.equal(d.effort, 'max')   // tier 3 + depth bump + horizon bump, clamped
    assert.equal(d.backend, 'systemone')
    assert.equal(d.strategy, 'systemone')
    assert.ok(Math.abs(d.signals.task_complexity - 2.8 / 3) < 1e-9)
    assert.ok(Math.abs(d.signals.ambiguity - 0.1) < 1e-9)
    assert.equal(d.signals.high_stakes, true)
    assert.equal(d.signals.underspecified, false)
    assert.equal(d.signals.long_horizon, true)
    assert.ok(d.confidence > 0 && d.confidence <= 1)
    assert.match(d.reason, /systemone\(nimble\)/)
    assert.match(d.reason, /tier=fable p=0\.81/) // direct pick recorded for observability
    assert.ok(d.latencyMs < 2000)
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('2. a missing signal answer is a hard failure (chain can fall back)', async () => {
  const server = await stubSystemOne(() => {
    const answers = cannedAnswers()
    delete answers.novelty
    return { answers }
  })
  try {
    await assert.rejects(() => systemoneRoute(TRADING_PROMPT, {}, configFor(server)), /missing answer for "novelty"/)
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('3. HTTP errors (e.g. model not pulled) throw with the status', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'model "nimble" not found, try pulling it first' }))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    await assert.rejects(() => systemoneRoute(TRADING_PROMPT, {}, configFor(server)), /HTTP 404/)
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('4. brain timeout throws within timeoutMs', async () => {
  const server = http.createServer(() => { /* never replies */ })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const config = configFor(server, { timeoutMs: 200 })
    await assert.rejects(() => systemoneRoute(TRADING_PROMPT, {}, config), /timeout after 200ms/)
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('5. strategy "systemone" routes with no fallback wrapper', async () => {
  const server = await stubSystemOne({ answers: cannedAnswers() })
  try {
    const config = configFor(server)
    config.router.strategy = 'systemone'
    const d = await route(TRADING_PROMPT, {}, config)
    assert.equal(d.strategy, 'systemone')
    assert.equal(d.backend, 'systemone')
    assert.equal(d.tier, 'fable')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('6. chain with brain=systemone prefers the local decision model', async () => {
  const server = await stubSystemOne({ answers: cannedAnswers() })
  try {
    const config = configFor(server)
    config.router.strategy = 'chain'
    config.router.brain = 'systemone'
    const d = await route('fix typo in readme', {}, config)
    assert.equal(d.strategy, 'chain')
    assert.equal(d.backend, 'systemone')
    assert.equal(d.tier, 'fable') // stub answers dominate — proves the brain ran
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('7. chain with brain=systemone falls back to heuristic when Ollama is down', async () => {
  const config = structuredClone(DEFAULT_CONFIG)
  config.systemone.url = 'http://127.0.0.1:1' // closed port
  config.systemone.timeoutMs = 1000
  config.router.strategy = 'chain'
  config.router.brain = 'systemone'
  const d = await route('fix typo in readme', {}, config)
  assert.equal(d.backend, 'heuristic')
  assert.equal(d.tier, 'haiku')
  assert.match(d.reason, /brain unavailable: systemone brain request failed/)
})

test('8. chain with default brain=jev is unaffected by systemone config', async () => {
  const server = await stubSystemOne({ choices: [] }) // jev brain would hit /v1/chat/completions
  try {
    const config = configFor(server)
    config.jev.url = `http://127.0.0.1:${server.address().port}/v1`
    config.jev.timeoutMs = 500
    config.router.strategy = 'chain'
    // stub replies without .choices[0].message.content → jev brain throws → fallback
    const d = await route('fix typo in readme', {}, config)
    assert.equal(d.backend, 'heuristic')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('9. env wires JEV_SYSTEMONE_* and JEV_BRAIN; strategy accepts systemone', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'jev-systemone-'))
  const config = await loadConfig({}, {
    JEV_SYSTEMONE_URL: 'http://127.0.0.1:11434',
    JEV_SYSTEMONE_MODEL: 'tev1:4b',
    JEV_SYSTEMONE_TIMEOUT_MS: '2500',
    JEV_BRAIN: 'systemone',
    JEV_STRATEGY: 'systemone',
  }, home)
  assert.equal(config.systemone.url, 'http://127.0.0.1:11434')
  assert.equal(config.systemone.model, 'tev1:4b')
  assert.equal(config.systemone.timeoutMs, 2500)
  assert.equal(config.router.brain, 'systemone')
  assert.equal(config.router.strategy, 'systemone')
})

test('10. bogus brain is rejected; bogus strategy still rejected', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'jev-systemone-'))
  await assert.rejects(() => loadConfig({}, { JEV_BRAIN: 'bogus' }, home), /router\.brain/)
  await assert.rejects(() => loadConfig({}, { JEV_STRATEGY: 'bogus' }, home), /strategy/)
})

test('11. redacted() hides the systemone api key too', () => {
  const config = structuredClone(DEFAULT_CONFIG)
  config.systemone.apiKey = 'super-secret'
  const safe = redacted(config)
  assert.equal(safe.systemone.apiKey, '***')
  assert.equal(config.systemone.apiKey, 'super-secret')
})

test('12. overlong prompts are truncated to fit the 8192-token question context', async () => {
  const server = await stubSystemOne({ answers: cannedAnswers() }, (body) => {
    assert.ok(body.state.length <= 6000)
  })
  try {
    const d = await systemoneRoute(TRADING_PROMPT.repeat(20), {}, configFor(server))
    assert.equal(d.tier, 'fable')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('13. every signal key maps cleanly (no signal dropped on the floor)', async () => {
  const server = await stubSystemOne({ answers: cannedAnswers() })
  try {
    const d = await systemoneRoute(TRADING_PROMPT, {}, configFor(server))
    assert.deepEqual(Object.keys(d.signals).sort(), [...SIGNAL_KEYS].sort())
  } finally {
    await new Promise((r) => server.close(r))
  }
})
