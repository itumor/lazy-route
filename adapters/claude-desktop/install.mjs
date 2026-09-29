#!/usr/bin/env node
// adapters/claude-desktop/install.mjs — merge the JEV env block into
// ~/.claude/settings.json without clobbering unrelated keys.
//   --dry-run    print the merged result, write nothing
//   --uninstall  remove exactly the JEV-managed keys
//   --home <dir> override home directory (tests)

import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { desktopEnv, desktopEnvInstructions, DESKTOP_KEYS } from './config.mjs'
import { loadConfig, deepMerge } from '../../core/index.mjs'

function parseArgs(argv) {
  const flags = { dryRun: false, uninstall: false, home: os.homedir() }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') flags.dryRun = true
    else if (a === '--uninstall') flags.uninstall = true
    else if (a === '--help' || a === '-h') flags.help = true
    else if (a === '--home') flags.home = argv[++i]
    else throw new Error(`unexpected argument: ${a}`)
  }
  return flags
}

function readSettings(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    if (err && err.code === 'ENOENT') return {}
    throw new Error(`cannot parse ${file}: ${err.message}`)
  }
}

async function main() {
  let flags
  try {
    flags = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`jev install: ${err.message}`)
    process.exit(2)
  }
  if (flags.help) {
    console.log('usage: install.mjs [--dry-run] [--uninstall] [--home <dir>]')
    return
  }

  // Never inherit the real JEV env in install context unless explicitly set.
  const env = { ...process.env }
  const config = await loadConfig({}, env, flags.home)

  const claudeDir = path.join(flags.home, '.claude')
  const settingsPath = path.join(claudeDir, 'settings.json')
  const current = readSettings(settingsPath)

  let next
  if (flags.uninstall) {
    next = { ...current, env: { ...(current.env || {}) } }
    for (const key of DESKTOP_KEYS) delete next.env[key]
    if (Object.keys(next.env).length === 0) delete next.env
  } else {
    next = deepMerge(current, { env: desktopEnv(config) })
  }

  if (flags.dryRun) {
    console.log('--- dry run: would write ' + settingsPath + ' ---')
    console.log(JSON.stringify(next, null, 2))
    return
  }

  mkdirSync(claudeDir, { recursive: true })
  let backupPath = null
  try {
    backupPath = `${settingsPath}.bak.${Date.now()}`
    copyFileSync(settingsPath, backupPath)
  } catch { backupPath = null /* no existing settings to back up */ }

  writeFileSync(settingsPath, JSON.stringify(next, null, 2) + '\n')
  console.log(`${flags.uninstall ? 'Removed JEV keys from' : 'Installed JEV env into'} ${settingsPath}${backupPath ? ` (backup: ${backupPath})` : ''}`)
  if (!flags.uninstall) {
    console.log('\nNext steps:')
    for (const line of desktopEnvInstructions(config)) console.log('  ' + line)
  }
}

main().catch((err) => {
  console.error(`jev install: ${err.message}`)
  process.exit(1)
})
