// adapters/lib/ensure-daemon.mjs — shared "is routerd up? if not, start it" helper.

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROUTERD = path.resolve(fileURLToPath(import.meta.url), '../../../daemon/jev-routerd.mjs')

export async function healthCheck({ host = '127.0.0.1', port = 38471, timeoutMs = 2000 } = {}) {
  try {
    const res = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

export async function ensureDaemon({
  host = '127.0.0.1',
  port = 38471,
  autoSpawn = true,
  waitMs = 5000,
  env = process.env,
} = {}) {
  if (await healthCheck({ host, port })) return { started: false }

  if (!autoSpawn) {
    throw new Error(`jev-routerd not running at http://${host}:${port} and auto-spawn disabled (start it: node daemon/jev-routerd.mjs)`)
  }

  const routerdPath = env.JEV_ROUTERD || ROUTERD
  const child = spawn(process.execPath, [routerdPath, '--host', host, '--port', String(port)], {
    detached: true,
    stdio: 'ignore',
    env,
  })
  child.unref()

  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250))
    if (await healthCheck({ host, port, timeoutMs: 500 })) return { started: true }
  }
  throw new Error(`jev-routerd did not become healthy within ${waitMs}ms (spawned pid ${child.pid})`)
}
