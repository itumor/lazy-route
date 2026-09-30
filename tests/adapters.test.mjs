// tests/adapters.test.mjs — adapter E2E with stub binaries and stub servers.

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawnSync, spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, chmodSync } from 'node:fs'
import { desktopEnv, desktopEnvInstructions, DESKTOP_KEYS } from '../adapters/claude-desktop/config.mjs'
import { healthCheck } from '../adapters/lib/ensure-daemon.mjs'

// NOTE on E2E topology: in this sandbox a socket listener must live in its own
// process for OTHER processes to connect (same-process or parent-owned servers
// time out for children). Launcher tests therefore spawn their stub servers as
// sibling child processes and wait for the LISTENING line.

const ROOT = new URL('..', import.meta.url).pathname

function tmpHome() { return mkdtempSync(path.join(os.tmpdir(), 'jev-adapter-')) }

// In-process server for same-process tests (healthCheck client runs here too).
function stubServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(r)) }))
  })
}

// Child-process server for cross-process launcher tests.
function spawnStubScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('stub did not become ready')) }, 8000)
    child.stdout.on('data', (c) => {
      out += c.toString()
      const m = out.match(/LISTENING (\d+)/)
      if (m) {
        clearTimeout(timer)
        resolve({ port: Number(m[1]), child, stop: () => child.kill('SIGTERM') })
      }
    })
    child.stderr.on('data', (c) => { out += c.toString() })
    child.on('exit', () => { if (!timer._destroyed) { clearTimeout(timer); reject(new Error('stub exited: ' + out)) } })
  })
}

function daemonStub() {
  return spawnStubScript(path.join(ROOT, 'tests/helpers/stub-daemon.mjs'))
}

function fakeBin(home, name, script) {
  const p = path.join(home, name)
  writeFileSync(p, script)
  chmodSync(p, 0o755)
  return p
}

// (a) desktopEnv: exact ANTHROPIC_* block, correctly spelled, from daemon config
test('a. desktopEnv returns the exact env block', () => {
  const env = desktopEnv({ daemon: { host: '127.0.0.1', port: 40000 } })
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:40000')
  assert.equal(env.ANTHROPIC_CUSTOM_MODEL_OPTION, 'jev-router')
  assert.equal(env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME, 'JEV Router')
  assert.match(env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION, /model and effort/i)
  assert.ok(Object.keys(env).every((k) => k.startsWith('ANTHROPIC_')))
  const instructions = desktopEnvInstructions({ daemon: { host: '127.0.0.1', port: 40000 } })
  assert.ok(instructions.some((l) => l.includes('Code tab')))
})

// (b) install --dry-run preserves unrelated keys and shows the merged env
test('b. install.mjs --dry-run preserves unrelated settings keys', () => {
  const home = tmpHome()
  mkdirSync(path.join(home, '.claude'), { recursive: true })
  writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    theme: 'dark',
    permissions: { allow: ['Bash(ls:*)'] },
    env: { EXISTING: 'keep-me' },
  }))
  const out = execFileSync(process.execPath, [
    path.join(ROOT, 'adapters/claude-desktop/install.mjs'), '--dry-run', '--home', home,
  ], { env: { ...process.env, JEV_CONFIG: path.join(home, 'absent.json') } }).toString()
  assert.match(out, /"theme": "dark"/)
  assert.match(out, /"EXISTING": "keep-me"/)
  assert.match(out, /"ANTHROPIC_CUSTOM_MODEL_OPTION": "jev-router"/)
  // dry run writes nothing beyond the original file
  assert.deepEqual(readdirSync(path.join(home, '.claude')), ['settings.json'])
})

// (c) real install: idempotent, creates a backup, uninstall removes only JEV keys
test('c. install + uninstall are idempotent and safe', () => {
  const home = tmpHome()
  mkdirSync(path.join(home, '.claude'), { recursive: true })
  writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ theme: 'dark', env: { EXISTING: 'keep' } }))
  const env = { ...process.env, JEV_CONFIG: path.join(home, 'absent.json') }
  const installer = path.join(ROOT, 'adapters/claude-desktop/install.mjs')

  execFileSync(process.execPath, [installer, '--home', home], { env })
  execFileSync(process.execPath, [installer, '--home', home], { env }) // second run = idempotent
  const installed = JSON.parse(readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'))
  assert.equal(installed.theme, 'dark')
  assert.equal(installed.env.EXISTING, 'keep')
  assert.equal(installed.env.ANTHROPIC_CUSTOM_MODEL_OPTION, 'jev-router')
  assert.ok(readdirSync(path.join(home, '.claude')).some((f) => f.startsWith('settings.json.bak.')))

  execFileSync(process.execPath, [installer, '--home', home, '--uninstall'], { env })
  const after = JSON.parse(readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'))
  for (const key of DESKTOP_KEYS) assert.ok(!(key in (after.env || {})))
  assert.equal(after.env.EXISTING, 'keep')
})

// (d) healthCheck: fast true against stub, fast false against closed port
test('d. ensure-daemon health check', async () => {
  const { port, close } = await stubServer((req, res) => res.writeHead(200).end('{"ok":true}'))
  assert.equal(await healthCheck({ port, timeoutMs: 800 }), true)
  await close()
  assert.equal(await healthCheck({ port, timeoutMs: 300 }), false)
})

// (e) jev-codex maps the daemon decision onto config.tiers and spawns codex -m
test('e. jev-codex spawns codex with the routed model', async (t) => {
  if (process.platform === 'win32') return t.skip('posix shell stubs')
  const home = tmpHome()
  const stub = await daemonStub()
  const codexArgs = path.join(home, 'codex-args.txt')
  const fakeCodex = fakeBin(home, 'codex', `#!/bin/sh\nprintf '%s ' "$@" > "${codexArgs}"\n`)
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'adapters/codex/jev-codex.mjs'), 'build', 'the', 'thing',
  ], {
    env: { ...process.env, JEV_PORT: String(stub.port), JEV_CODEX_BIN: fakeCodex, JEV_CONFIG: path.join(home, 'absent.json') },
    encoding: 'utf8',
  })
  stub.stop()
  assert.equal(result.status, 0, result.stderr)
  const args = readFileSync(codexArgs, 'utf8')
  assert.match(args, /^-m claude-opus-5-5 build the thing/) // tier opus → default tier map
  assert.match(result.stderr, /tier=opus effort=high.*→ claude-opus-5-5/)
})

// (f) jev-claude injects ANTHROPIC_* env into the claude child (--no-spawn against stub)
test('f. jev-claude injects the routing env into claude', async (t) => {
  if (process.platform === 'win32') return t.skip('posix shell stubs')
  const home = tmpHome()
  const stub = await spawnStubScript(path.join(ROOT, 'tests/helpers/stub-health.mjs'))
  const capture = path.join(home, 'claude-env.txt')
  const fakeClaude = fakeBin(home, 'claude', `#!/bin/sh\nenv | grep ANTHROPIC_ > "${capture}"\nprintf 'args:%s' "$1"\n`)
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'adapters/claude-cli/jev-claude.mjs'), '--no-spawn', '--dangerously-skip-permissions',
  ], {
    env: { ...process.env, JEV_PORT: String(stub.port), JEV_CLAUDE_BIN: fakeClaude },
    encoding: 'utf8',
  })
  stub.stop()
  assert.equal(result.status, 0, result.stderr)
  const env = readFileSync(capture, 'utf8')
  assert.match(env, new RegExp(`ANTHROPIC_BASE_URL=http://127.0.0.1:${stub.port}`))
  assert.match(env, /ANTHROPIC_CUSTOM_MODEL_OPTION=jev-router/)
  assert.match(env, /ANTHROPIC_CUSTOM_MODEL_OPTION_NAME=JEV Router/)
  assert.match(result.stdout, /args:--dangerously-skip-permissions/)
})

// (g) plugin skills exist and reference the right endpoints
test('g. plugin skills + hooks reference the daemon endpoints', () => {
  const read = (p) => readFileSync(path.join(ROOT, p), 'utf8')
  assert.match(read('plugin/skills/jev-status.md'), /\/jev\/status/)
  assert.match(read('plugin/skills/jev-explain.md'), /\/jev\/route/)
  assert.match(read('plugin/skills/jev-models.md'), /\/jev\/status/)
  assert.match(read('plugin/hooks/hooks.json'), /\/health/)
  assert.match(read('plugin/README.md'), /after.*model is already selected/i)
  const manifest = JSON.parse(read('plugin/.claude-plugin/plugin.json'))
  assert.equal(manifest.name, 'jev-router')
})

// (h) codex config snippet documents the launch-time routing boundary
test('h. codex config snippet is honest about passthrough-only wire level', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'adapters/codex/config-snippet.mjs')], { encoding: 'utf8' }).toString()
  assert.match(out, /launch-time routing/)
  assert.match(out, /model_providers\.jev/)
  assert.match(out, /passthrough only/)
})
