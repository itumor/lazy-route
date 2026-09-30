#!/usr/bin/env node
// daemon/jev-routerd.mjs — JEV routing sidecar entrypoint.

import { loadConfig } from '../core/index.mjs'
import { createDaemon, VERSION } from './server.mjs'

const HELP = `jev-routerd ${VERSION} — local model+effort routing sidecar

Usage: jev-routerd [options]

Options:
  --config <path>        config file (default: ~/.jev/router.json)
  --port <n>             listen port (env JEV_PORT, default 38471)
  --host <h>             listen host (env JEV_HOST, default 127.0.0.1 — loopback only)
  --jev-url <url>        routing-brain base URL, e.g. http://localhost:11434/v1 for Ollama
  --jev-model <model>    brain model name at that URL
  --systemone-url <url>  System One brain base URL (env JEV_SYSTEMONE_URL, default http://localhost:11434)
  --systemone-model <m>  System One decision model (env JEV_SYSTEMONE_MODEL, default nimble)
  --brain <b>            brain used by --strategy chain: jev | systemone (env JEV_BRAIN, default jev)
  --upstream-url <url>   upstream provider base URL (default https://api.anthropic.com)
  --strategy <s>         chain | jev | systemone | heuristic (default chain)
  --help, -h

Config precedence: defaults < config file < env (JEV_*) < flags.
Secrets: JEV_API_KEY is read from env/config only, redacted from /jev/status,
and upstream Authorization headers are forwarded, never stored or logged.`

function parseArgs(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') return { help: true }
    if (!arg.startsWith('--')) {
      throw new Error(`unexpected argument: ${arg}`)
    }
    const key = arg.slice(2)
    const value = argv[++i]
    if (value === undefined) throw new Error(`flag ${arg} requires a value`)
    flags[key] = value
  }
  return flags
}

async function main() {
  let flags
  try {
    flags = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`jev-routerd: ${err.message}`)
    process.exit(2)
  }
  if (flags.help) {
    console.log(HELP)
    process.exit(0)
  }

  const env = { ...process.env }
  if (flags.config) env.JEV_CONFIG = flags.config

  const overrides = {}
  const put = (path, value, numeric = false) => {
    if (value === undefined) return
    let node = overrides
    for (let i = 0; i < path.length - 1; i++) node = node[path[i]] ??= {}
    node[path[path.length - 1]] = numeric ? Number(value) : value
  }
  put(['daemon', 'port'], flags.port, true)
  put(['daemon', 'host'], flags.host)
  put(['jev', 'url'], flags['jev-url'])
  put(['jev', 'model'], flags['jev-model'])
  put(['systemone', 'url'], flags['systemone-url'])
  put(['systemone', 'model'], flags['systemone-model'])
  put(['upstream', 'url'], flags['upstream-url'])
  put(['router', 'strategy'], flags.strategy)
  put(['router', 'brain'], flags.brain)

  let config
  try {
    config = await loadConfig(overrides, env)
  } catch (err) {
    console.error(`jev-routerd: config error: ${err.message}`)
    process.exit(1)
  }

  let daemon
  try {
    daemon = await createDaemon(config)
  } catch (err) {
    console.error(`jev-routerd: failed to listen on ${config.daemon.host}:${config.daemon.port}: ${err.message}`)
    process.exit(1)
  }
  const brainUrl = config.router.brain === 'systemone' ? `${config.systemone.url}/v1/systemone` : config.jev.url
  console.log(`jev-routerd listening on http://${daemon.host}:${daemon.port} (strategy=${config.router.strategy}, brain=${config.router.brain}@${brainUrl}, upstream=${config.upstream.url})`)

  const shutdown = (signal) => {
    console.log(`jev-routerd: ${signal} received, shutting down`)
    daemon.close().then(() => process.exit(0))
    setTimeout(() => process.exit(1), 3000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error(`jev-routerd: fatal: ${err && err.stack || err}`)
  process.exit(1)
})
