// core/systemone-client.mjs — brain backend for local decision models
// (Ollama's /v1/systemone endpoint: Nimble 9B, Tev1 4B/0.8B, …).
//
// The endpoint implements TypeSafe's Jev question API — the same
// {type, instructions, criteria} schema as core/questionnaire.mjs — so the
// questionnaire is sent VERBATIM as the "questions" field. One HTTP call
// answers all 17 questions (limit is 64) and returns, per question,
// a typed answer with probabilities. No JSON-parsing of free text: scores
// and nouls arrive as numbers; choice answers arrive as validated labels.
//
// As with the chat brain: the brain supplies evidence, core/policy.mjs owns
// the final tier+effort. Nimble's direct model_tier/effort picks are recorded
// in the reason for observability (and as a disagreement signal), not obeyed.

import { QUESTIONNAIRE, SIGNAL_KEYS, BOOL_KEYS } from './questionnaire.mjs'
import { decide, confidenceFor, TIERS, EFFORTS } from './policy.mjs'

// System One scores each question with (full state + question set) in a
// per-question 8192-token prompt; the questionnaire itself is ~1.5k tokens.
// Keep the judged text well inside the remainder.
const MAX_STATE_CHARS = 6000

// Nimble answers a noul with "noul": p(true) and a score with "score":
// the probability-weighted level on a 0..(levels-1) scale. Normalize that
// weighted level into the 0..1 signal space the policy consumes.
function answersToSignals(answers) {
  const signals = {}
  const confidences = []
  for (const key of SIGNAL_KEYS) {
    const a = answers[key]
    if (!a || typeof a !== 'object') throw new Error(`systemone brain reply missing answer for "${key}"`)
    if (BOOL_KEYS.includes(key)) {
      const p = Number(a.noul)
      if (!Number.isFinite(p)) throw new Error(`systemone answer "${key}" has no finite noul probability`)
      const clamped = Math.max(0, Math.min(1, p))
      signals[key] = clamped >= 0.5
      confidences.push(Math.abs(2 * clamped - 1)) // concentration: 0 at p=0.5, 1 at the extremes
    } else {
      const levels = QUESTIONNAIRE[key].criteria.length
      const s = Number(a.score)
      if (!Number.isFinite(s)) throw new Error(`systemone answer "${key}" has no finite score`)
      signals[key] = Math.max(0, Math.min(1, s / Math.max(1, levels - 1)))
      const c = Number(a.confidence)
      if (Number.isFinite(c)) confidences.push(Math.max(0, Math.min(1, c)))
    }
  }
  const meanConfidence = confidences.reduce((sum, c) => sum + c, 0) / Math.max(1, confidences.length)
  return { signals, meanConfidence }
}

// Capture a direct choice answer (model_tier / effort) as evidence for the
// reason string. Returns undefined when the answer is absent or names an
// option not in the question's criteria — malformed picks are never fatal.
function directPick(answers, key, options) {
  const a = answers && answers[key]
  if (!a || typeof a !== 'object' || typeof a.choice !== 'string') return undefined
  if (!options.includes(a.choice)) return undefined
  const p = a.probabilities && typeof a.probabilities === 'object' ? Number(a.probabilities[a.choice]) : NaN
  return { choice: a.choice, probability: Number.isFinite(p) ? p : undefined }
}

export async function systemoneRoute(request, context = {}, config) {
  const t0 = Date.now()
  const base = String(config.systemone.url).replace(/\/+$/, '')
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error(`systemone brain timeout after ${config.systemone.timeoutMs}ms`)),
    config.systemone.timeoutMs,
  )
  let res
  try {
    const ctx = context && typeof context === 'object' && Object.keys(context).length ? context : undefined
    res = await fetch(`${base}/v1/systemone`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.systemone.apiKey ? { authorization: `Bearer ${config.systemone.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.systemone.model,
        state: ctx
          ? { request: String(request).slice(0, MAX_STATE_CHARS), context: ctx }
          : String(request).slice(0, MAX_STATE_CHARS),
        questions: QUESTIONNAIRE,
        ...(config.systemone.keepAlive ? { keep_alive: config.systemone.keepAlive } : {}),
      }),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    throw new Error(`systemone brain request failed: ${err && err.message ? err.message : err}`)
  }
  clearTimeout(timer)
  if (!res.ok) throw new Error(`systemone brain replied HTTP ${res.status} (is model "${config.systemone.model}" pulled?)`)
  const payload = await res.json()
  const answers = payload && typeof payload === 'object' ? payload.answers : undefined
  if (!answers || typeof answers !== 'object') throw new Error('systemone brain reply contained no answers object')

  const { signals, meanConfidence } = answersToSignals(answers)
  const { tier, effort, aggregate } = decide(signals)

  const tierPick = directPick(answers, 'model_tier', TIERS)
  const effortPick = directPick(answers, 'effort', EFFORTS)
  const fmtPick = (p) => (p ? `${p.choice}${p.probability !== undefined ? ` p=${p.probability.toFixed(2)}` : ''}` : undefined)
  const picks = [fmtPick(tierPick) && `tier=${fmtPick(tierPick)}`, fmtPick(effortPick) && `effort=${fmtPick(effortPick)}`]
    .filter(Boolean).join(', ') || 'none'

  // Policy confidence (distance from the tie boundary), attenuated by how
  // concentrated the brain's per-question probabilities were on average.
  const confidence = Math.max(0, Math.min(1, confidenceFor(aggregate, tier) * (0.5 + 0.5 * meanConfidence)))

  return {
    tier,
    effort,
    confidence,
    strategy: 'systemone',
    backend: 'systemone',
    signals,
    reason: `systemone(${config.systemone.model}): signals → policy aggregate ${aggregate.toFixed(2)} → ${tier}/${effort}; direct picks ${picks}; mean answer confidence ${meanConfidence.toFixed(2)}`,
    latencyMs: Date.now() - t0,
  }
}
