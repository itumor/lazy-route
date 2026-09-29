#!/usr/bin/env node
// adapters/claude-cli/jev-claude.mjs — Claude Code CLI launcher with JEV routing.
// Ensures jev-routerd runs, then launches `claude` pointed at the daemon with a
// custom "JEV Router" model option injected into the model picker.

import { spawn } from 'node:child_process'
import { ensureDaemon } from '../lib/ensure-daemon.mjs'

const HELP = `jev-claude [jev flags] [-- claude args...]

Launches Claude Code CLI with model+effort routing via the local jev-routerd.

Flags:
  --print-env    print the env block that would be applied, then exit
  --no-spawn     do not auto-start jev-routerd (fail if not running)
  --help, -h

Everything after the flags is passed straight to the claude binary.
Env overrides: JEV_PORT, JEV_HOST, JEV_ROUTERD, JEV_CLAUDE_BIN.`

export function claudeEnv({ host, port }) {
  return {
    ANTHROPIC_BASE_URL: `http://${host}:${port}`,
    ANTHROPIC_CUSTOM_MODEL_OPTION: 'jev-router',
    ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: 'JEV Router',
    ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION: 'Automatically choose model and effort per turn via JEV',
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const flags = new Set()
  const rest = []
  for (const a of argv) {
    if (a.startsWith('--') && rest.length === 0 && ['--print-env', '--no-spawn', '--help', '-h'].includes(a)) flags.add(a)
    else rest.push(a)
  }
  const host = process.env.JEV_HOST || '127.0.0.1'
  const port = Number(process.env.JEV_PORT || 38471)

  if (flags.has('--help') || flags.has('-h')) { console.log(HELP); return }

  const env = claudeEnv({ host, port })
  if (flags.has('--print-env')) {
    for (const [k, v] of Object.entries(env)) console.log(`${k}=${v}`)
    return
  }

  try {
    const { started } = await ensureDaemon({ host, port, autoSpawn: !flags.has('--no-spawn'), env: process.env })
    if (started) console.error(`jev: started jev-routerd on http://${host}:${port}`)
  } catch (err) {
    console.error(`jev-claude: ${err.message}`)
    process.exit(1)
  }

  const bin = process.env.JEV_CLAUDE_BIN || 'claude'
  const child = spawn(bin, rest, { stdio: 'inherit', env: { ...process.env, ...env } })
  child.on('error', (err) => {
    console.error(`jev-claude: cannot launch ${bin}: ${err.message}`)
    process.exit(127)
  })
  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 128 : 0))
  })
}

main()
