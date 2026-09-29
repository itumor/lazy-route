// core/jev-client.mjs — ask an OpenAI-compatible endpoint (the configured
// "brain": JEV API, Ollama, LM Studio, …) to fill the questionnaire with
// signal values. The final tier+effort ALWAYS comes from core/policy.mjs —
// the brain supplies evidence, policy owns the decision.

import { QUESTIONNAIRE, SIGNAL_KEYS, BOOL_KEYS } from './questionnaire.mjs'
import { decide, confidenceFor } from './policy.mjs'

function extractJson(content) {
  const s = String(content || '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('brain reply contained no JSON object')
  return JSON.parse(s.slice(start, end + 1))
}

function normalizeSignals(parsed) {
  const signals = {}
  const src = (parsed && typeof parsed.signals === 'object' && parsed.signals) || parsed || {}
  for (const key of SIGNAL_KEYS) {
    const v = src[key]
    if (v === undefined) continue
    if (BOOL_KEYS.includes(key)) {
      signals[key] = v === true || v === 'true' || v === 1
    } else {
      const n = Number(v)
      if (Number.isFinite(n)) signals[key] = Math.max(0, Math.min(1, n > 1 ? n / 10 : n))
    }
  }
  if (Object.keys(signals).length === 0) throw new Error('brain reply contained no usable signals')
  return signals
}

function systemPrompt() {
  return [
    'You are the routing brain for the JEV model router.',
    'Fill this questionnaire with signal values for the given task.',
    `QUESTIONNAIRE:\n${JSON.stringify(QUESTIONNAIRE)}`,
    'Reply with STRICT JSON ONLY: {"signals": {...}, "confidence": 0..1, "reason": "one sentence"}.',
    'Scores are 0..1 (0 = lowest band, 1 = highest band). Noul fields are booleans.',
    'Judge the actual work required, not wording or length.',
  ].join('\n\n')
}

export async function jevRoute(request, context = {}, config) {
  const t0 = Date.now()
  const base = String(config.jev.url).replace(/\/+$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`jev brain timeout after ${config.jev.timeoutMs}ms`)), config.jev.timeoutMs)
  let res
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.jev.apiKey ? { authorization: `Bearer ${config.jev.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.jev.model,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: JSON.stringify({ request: String(request), context }) },
        ],
      }),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    throw new Error(`jev brain request failed: ${err && err.message ? err.message : err}`)
  }
  clearTimeout(timer)
  if (!res.ok) throw new Error(`jev brain replied HTTP ${res.status}`)
  const payload = await res.json()
  const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content
    : undefined
  const parsed = extractJson(content)
  const signals = normalizeSignals(parsed)
  const { tier, effort, aggregate } = decide(signals)
  return {
    tier,
    effort,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || confidenceFor(aggregate, tier))),
    strategy: 'jev',
    backend: 'jev',
    signals,
    reason: String(parsed.reason || `brain signals → policy aggregate ${aggregate.toFixed(2)} → ${tier}/${effort}`).slice(0, 600),
    latencyMs: Date.now() - t0,
  }
}
