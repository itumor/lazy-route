#!/usr/bin/env node
// adapters/codex/jev-codex.mjs — launch-time routing for Codex CLI.
// One JEV decision per launch; codex then runs on the chosen concrete model.
// (Wire-level per-turn rewriting for Codex's Responses API is out of scope for v1.)

import { spawn } from 'node:child_process'
import { ensureDaemon } from '../lib/ensure-daemon.mjs'
import { loadConfig } from '../../core/index.mjs'

const HELP = `jev-codex [prompt words...]   (or pipe a prompt on stdin)

Asks the running jev-routerd to classify the prompt, then launches
  codex -m <tier-mapped model> [your args]
Env: JEV_PORT, JEV_HOST, JEV_QUIET=1, JEV_ROUTERD, JEV_CODEX_BIN.`

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return }

  const host = process.env.JEV_HOST || '127.0.0.1'
  const port = Number(process.env.JEV_PORT || 38471)

  let prompt = argv.join(' ').trim()
  if (!prompt && !process.stdin.isTTY) prompt = await readStdin()

  try {
    await ensureDaemon({ host, port, env: process.env })
  } catch (err) {
    console.error(`jev-codex: ${err.message}`)
    process.exit(1)
  }

  let decision = { tier: 'sonnet', effort: 'medium', backend: 'default' }
  if (prompt) {
    try {
      const res = await fetch(`http://${host}:${port}/jev/route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request: prompt }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      decision = await res.json()
    } catch (err) {
      console.error(`jev-codex: routing failed (${err.message}), using default tier`)
    }
  }

  const config = await loadConfig({}, { ...process.env, JEV_CONFIG: process.env.JEV_CONFIG || '' })
  const model = (config.tiers && config.tiers[decision.tier]) || config.tiers.sonnet
  if (!process.env.JEV_QUIET) {
    console.error(`jev: tier=${decision.tier} effort=${decision.effort} backend=${decision.backend} → ${model}`)
  }

  const bin = process.env.JEV_CODEX_BIN || 'codex'
  const child = spawn(bin, ['-m', model, ...argv], { stdio: 'inherit', env: process.env })
  child.on('error', (err) => {
    console.error(`jev-codex: cannot launch ${bin}: ${err.message}`)
    process.exit(127)
  })
  child.on('exit', (code) => process.exit(code ?? 0))
}

main()
