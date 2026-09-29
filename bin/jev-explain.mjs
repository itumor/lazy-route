#!/usr/bin/env node
// bin/jev-explain.mjs — ask the running daemon to classify a prompt (dry run).

import { describeDecision } from '../core/index.mjs'

const host = process.env.JEV_HOST || '127.0.0.1'
const port = process.env.JEV_PORT || 38471

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function main() {
  let prompt = process.argv.slice(2).join(' ').trim()
  if (!prompt && !process.stdin.isTTY) prompt = await readStdin()
  if (!prompt) {
    console.error('usage: jev-explain "<prompt>"   (or pipe a prompt on stdin)')
    process.exit(2)
  }

  let res
  try {
    res = await fetch(`http://${host}:${port}/jev/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request: prompt }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    console.error(`jev-explain: daemon unreachable at http://${host}:${port} (start it with jev-routerd)`)
    process.exit(1)
  }
  if (!res.ok) {
    console.error(`jev-explain: daemon returned HTTP ${res.status}: ${await res.text()}`)
    process.exit(1)
  }
  console.log(describeDecision(await res.json()))
}

main()
