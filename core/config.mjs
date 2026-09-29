// core/config.mjs — layered config loading:
//   DEFAULT_CONFIG < file (${JEV_CONFIG} || ~/.jev/router.json) < env < overrides
// Deep merge for plain objects; arrays/scalars replace.

import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'

export const DEFAULT_CONFIG = Object.freeze({
  jev: {
    url: 'https://api.jev.dev/v1',
    apiKey: '',
    model: 'jev-router',
    timeoutMs: 8000,
  },
  upstream: {
    url: 'https://api.anthropic.com',
  },
  daemon: {
    host: '127.0.0.1',
    port: 38471,
  },
  router: {
    strategy: 'chain', // chain | jev | heuristic
    aliasModels: ['jev-router'],
  },
  tiers: {
    haiku: 'claude-haiku-4-5',
    sonnet: 'claude-sonnet-4-5',
    opus: 'claude-opus-4-5',
    fable: 'claude-opus-4-5', // frontier slot; maps to strongest until a dedicated model exists
  },
  effortMap: {
    low: { thinking: { type: 'enabled', budget_tokens: 1024 } },
    medium: { thinking: { type: 'enabled', budget_tokens: 4096 } },
    high: { thinking: { type: 'enabled', budget_tokens: 16384 } },
    xhigh: { thinking: { type: 'enabled', budget_tokens: 32768 } },
    max: { thinking: { type: 'enabled', budget_tokens: 65536 } },
  },
})

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return patch === undefined ? base : patch
  const out = { ...(isPlainObject(base) ? base : {}) }
  for (const [k, v] of Object.entries(patch)) {
    // Always recurse into plain objects: copying them by reference would alias
    // the patch's (or base's) nested state into the result.
    out[k] = isPlainObject(v) ? deepMerge(isPlainObject(out[k]) ? out[k] : {}, v) : v
  }
  return out
}

function envPatch(env) {
  const patch = {}
  const put = (pathArr, value) => {
    if (value === undefined) return
    let node = patch
    for (let i = 0; i < pathArr.length - 1; i++) node = node[pathArr[i]] ??= {}
    node[pathArr[pathArr.length - 1]] = value
  }
  put(['jev', 'url'], env.JEV_API_URL)
  put(['jev', 'apiKey'], env.JEV_API_KEY)
  put(['jev', 'model'], env.JEV_MODEL)
  if (env.JEV_TIMEOUT_MS !== undefined && env.JEV_TIMEOUT_MS !== '') {
    const n = Number(env.JEV_TIMEOUT_MS)
    if (!Number.isFinite(n) || n <= 0) throw new Error(`JEV_TIMEOUT_MS must be a positive number, got ${env.JEV_TIMEOUT_MS}`)
    put(['jev', 'timeoutMs'], n)
  }
  put(['upstream', 'url'], env.JEV_UPSTREAM_URL)
  put(['daemon', 'host'], env.JEV_HOST)
  if (env.JEV_PORT !== undefined && env.JEV_PORT !== '') {
    const n = Number(env.JEV_PORT)
    if (!Number.isInteger(n) || n <= 0 || n > 65535) throw new Error(`JEV_PORT must be an integer 1..65535, got ${env.JEV_PORT}`)
    put(['daemon', 'port'], n)
  }
  put(['router', 'strategy'], env.JEV_STRATEGY)
  if (env.JEV_ALIAS_MODELS) {
    put(['router', 'aliasModels'], env.JEV_ALIAS_MODELS.split(',').map((s) => s.trim()).filter(Boolean))
  }
  for (const tier of ['HAIKU', 'SONNET', 'OPUS', 'FABLE']) {
    put(['tiers', tier.toLowerCase()], env[`JEV_TIER_${tier}`])
  }
  return patch
}

function loadFile(configPath) {
  let raw
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return {}
    throw err
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`jev config file ${configPath} is not valid JSON: ${err.message}`)
  }
}

export async function loadConfig(overrides = {}, env = process.env, homeDir = os.homedir()) {
  const configPath = env.JEV_CONFIG || path.join(homeDir, '.jev', 'router.json')
  let config = deepMerge(DEFAULT_CONFIG, loadFile(configPath))
  config = deepMerge(config, envPatch(env))
  config = deepMerge(config, overrides)
  if (!['chain', 'jev', 'heuristic'].includes(config.router.strategy)) {
    throw new Error(`router.strategy must be chain|jev|heuristic, got "${config.router.strategy}"`)
  }
  return config
}

// Redacted copy safe for /jev/status: never expose keys.
export function redacted(config) {
  const clone = deepMerge({}, config)
  if (clone.jev && clone.jev.apiKey) clone.jev.apiKey = '***'
  return clone
}
