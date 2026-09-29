// core/heuristic.mjs — offline deterministic signal extraction.
// Identical input → identical output. context.signals entries override any
// heuristically-derived signal (numbers clamped 0..1, booleans coerced).

import { SIGNAL_KEYS, BOOL_KEYS, SCORE_KEYS } from './questionnaire.mjs'
import { decide, confidenceFor } from './policy.mjs'

const KW = {
  highStakes: [
    /\bproduction\b/i, /\bsecurity\b/i, /\bfinancial\b/i, /\btrading\b/i, /\bpayments?\b/i,
    /\bcompliance\b/i, /\bprivacy\b/i, /\bdelete\b/i, /\bdrop\s+table\b/i, /\birreversible\b/i,
    /\bmigrat(e|ion|ing)\b/i, /\bdeploy/i, /\bauth(entication|orization)?\b/i, /\bsecrets?\b/i,
    /\bdisaster\s+recovery\b/i, /\brisk\s+controls?\b/i, /\bdata\s+loss\b/i, /\bHIPAA\b/i, /\bPCI\b/i,
  ],
  tools: [
    /\bfiles?\b/i, /\brepo(sitory)?\b/i, /\bterminal\b/i, /\bAPIs?\b/i, /\bdatabases?\b/i,
    /\bbrowser\b/i, /\bdeploy/i, /\brun\b/i, /\bexec(ute|ution)?\b/i, /\bcommit\b/i, /\bgit\b/i,
    /\bcurl\b/i, /\bserver\b/i, /\bcloud\b/i, /\bCI\/CD\b/i, /\btest(s|ing)?\b/i, /\bbuild\b/i,
    /\bcode(base)?\b/i, /\bdebug/i, /\bimplement/i, /\brefactor/i, /\bwrite\b/i, /\bcreat(e|ing)\b/i,
  ],
  longHorizon: [
    /\bend[- ]to[- ]end\b/i, /\bcontinu(e|ous|ing)\b/i, /\bautonom/i, /\bfrom\s+a\s+to\s+z\b/i,
    /\bstep[- ]by[- ]step\b/i, /\bmultiple\s+steps\b/i, /\bmany\s+dependent\b/i, /\breplan/i,
    /\blong[- ]running\b/i, /\biterativ/i, /\bentire\b/i, /\bfull(ly)?\s+autonomous\b/i,
    /\bsustain(ed|ing)\b/i, /\buntil\b.*\b(production[- ]ready|complete|validated|done)\b/i,
  ],
  planning: [
    /\barchitect(ure|ural)?\b/i, /\bdesign\b/i, /\bplan(ning)?\b/i, /\bmigrat(e|ion|ing)\b/i,
    /\brefactor/i, /\bstrateg/i, /\btrade[- ]?offs?\b/i, /\bdecompos/i, /\broadmap\b/i,
  ],
  novelty: [
    /\bnovel\b/i, /\bunprecedented\b/i, /\bfrontier\b/i, /\binvent/i, /\bfirst[- ]of[- ]its[- ]kind\b/i,
    /\bstate[- ]of[- ]the[- ]art\b/i, /\bresearch\s+(problem|question)\b/i, /\bprove\b.*\btheorem\b/i,
  ],
  expertise: [
    /\bdistributed\s+systems?\b/i, /\bconsensus\b/i, /\bcompilers?\b/i, /\bkernel\b/i,
    /\bcryptograph/i, /\bzero[- ]knowledge\b/i, /\bbyzantine\b/i, /\bquant/i, /\bmarket[- ]data\b/i,
    /\border\s+book\b/i, /\bbacktest/i, /\bformal\s+verif/i, /\bCRDTs?\b/i, /\blatency\b/i,
  ],
  complexity: [
    /\bentire\b/i, /\bcomplete\b.*\bsystem\b/i, /\bmulti[- ]?(service|step|stage|system)\b/i,
    /\brequirements\s+gathering\b/i, /\broot[- ]cause\b/i, /\barchitecture\b/i, /\brunbooks?\b/i,
    /\bportfolio\b/i, /\binfrastructure\b/i, /\bobservability\b/i, /\brepeated\s+tool\b/i,
  ],
}

function countHits(regexes, text) {
  let n = 0
  for (const re of regexes) if (re.test(text)) n++
  return n
}

// Densities: keyword-group hit counts normalized by group size (0..1-ish curve).
function density(hits, total) {
  const x = hits / Math.max(1, Math.ceil(total * 0.5))
  return Math.min(1, x)
}

export function heuristicSignals(request, context = {}) {
  const text = String(request || '')
  const words = text.split(/\s+/).filter(Boolean).length
  const questions = (text.match(/\?/g) || []).length

  const stakesHits = countHits(KW.highStakes, text)
  const toolHits = countHits(KW.tools, text)
  const horizonHits = countHits(KW.longHorizon, text)
  const planHits = countHits(KW.planning, text)
  const noveltyHits = countHits(KW.novelty, text)
  const expertHits = countHits(KW.expertise, text)
  const complexHits = countHits(KW.complexity, text)

  // Base priors for a generic ask; each signal nudged by evidence.
  const signals = {
    task_complexity: Math.min(1, 0.15 + 0.25 * density(complexHits, KW.complexity.length) + 0.30 * density(expertHits, KW.expertise.length) + 0.10 * Math.min(1, words / 900)),
    ambiguity: Math.min(1, 0.10 + 0.25 * (questions > 2 ? 1 : questions > 0 ? 0.5 : 0) + (/maybe|perhaps|not sure|\bor should\b/i.test(text) ? 0.35 : 0) + (words < 12 ? 0.15 : 0)),
    underspecified: /\b(something|somehow|stuff|whatever|etc\.?)\b/i.test(text) || (words < 6),
    high_stakes: stakesHits > 0,
    requires_tools: toolHits > 0,
    tool_complexity: Math.min(1, (toolHits === 0 ? 0 : 0.15 + 0.17 * toolHits)),
    execution_depth: Math.min(1, 0.10 + 0.45 * density(horizonHits, KW.longHorizon.length) + 0.25 * density(complexHits, KW.complexity.length) + 0.10 * Math.min(1, words / 800)),
    long_horizon: horizonHits >= 2,
    verification_difficulty: Math.min(1, 0.15 + 0.20 * (toolHits > 0 ? 1 : 0) + 0.35 * density(complexHits, KW.complexity.length) + (stakesHits > 0 ? 0.2 : 0)),
    specialized_expertise: Math.min(1, 0.15 + 0.55 * density(expertHits, KW.expertise.length) + 0.2 * density(complexHits, KW.complexity.length)),
    failure_recovery_complexity: Math.min(1, 0.10 + (stakesHits > 0 ? 0.4 : 0) + 0.25 * density(toolHits, KW.tools.length) + (horizonHits >= 2 ? 0.2 : 0)),
    context_complexity: Math.min(1, 0.10 + 0.30 * density(complexHits, KW.complexity.length) + 0.20 * Math.min(1, words / 700) + 0.15 * density(toolHits, KW.tools.length)),
    planning_required: Math.min(1, 0.10 + 0.60 * density(planHits, KW.planning.length) + (horizonHits >= 2 ? 0.2 : 0)),
    reversibility: Math.min(1, Math.max(0, 0.9 - (stakesHits > 0 ? 0.45 : 0) - 0.15 * density(toolHits, KW.tools.length) - (/\bdelete|drop\s+table|force[- ]push|irreversible\b/i.test(text) ? 0.35 : 0) - (/\bproduction\b/i.test(text) ? 0.1 : 0))),
    novelty: Math.min(1, 0.05 + 0.55 * density(noveltyHits, KW.novelty.length) + 0.15 * density(expertHits, KW.expertise.length)),
  }

  // Explicit signal overrides (numbers clamped 0..1; booleans coerced).
  const overrides = (context && typeof context === 'object' ? context.signals : undefined) || {}
  for (const key of SIGNAL_KEYS) {
    if (!(key in overrides)) continue
    const v = overrides[key]
    if (BOOL_KEYS.includes(key)) signals[key] = v === true || v === 'true' || v === 1
    else if (SCORE_KEYS.includes(key)) {
      const n = Number(v)
      if (Number.isFinite(n)) signals[key] = Math.max(0, Math.min(1, n > 1 ? n / 10 : n))
    }
  }
  return signals
}

export function heuristicRoute(request, context = {}, config) {
  void config // heuristic needs no config today; signature kept stable
  const t0 = Date.now()
  const signals = heuristicSignals(request, context)
  const { tier, effort, aggregate } = decide(signals)
  const notable = [
    signals.high_stakes && 'high-stakes',
    signals.long_horizon && 'long-horizon',
    signals.requires_tools && 'tool-driven',
    (Number(signals.task_complexity) >= 0.75) && 'deep-complexity',
    (Number(signals.task_complexity) < 0.25) && 'trivial',
    (Number(signals.novelty) >= 0.7) && 'novel',
  ].filter(Boolean).join(', ')
  return {
    tier,
    effort,
    confidence: confidenceFor(aggregate, tier),
    strategy: 'heuristic',
    backend: 'heuristic',
    signals,
    reason: `deterministic heuristic: aggregate ${aggregate.toFixed(2)} (${notable || 'no dominant signals'}) → ${tier}/${effort}`,
    latencyMs: Date.now() - t0,
  }
}
