// core/index.mjs — frozen public surface of the routing engine.
// See docs/ARCHITECTURE.md for the cross-module contract.

import { QUESTIONNAIRE, SIGNAL_KEYS } from './questionnaire.mjs'
import { loadConfig, DEFAULT_CONFIG, redacted, deepMerge } from './config.mjs'
import { heuristicRoute, heuristicSignals } from './heuristic.mjs'
import { jevRoute } from './jev-client.mjs'
import { systemoneRoute } from './systemone-client.mjs'
import { TIERS, EFFORTS, TIER_ORDER, EFFORT_ORDER } from './policy.mjs'

export { QUESTIONNAIRE, SIGNAL_KEYS }
export { loadConfig, DEFAULT_CONFIG, redacted, deepMerge }
export { heuristicRoute, heuristicSignals }
export { jevRoute }
export { systemoneRoute }
export { TIERS, EFFORTS, TIER_ORDER, EFFORT_ORDER }
export { decide, aggregate, WEIGHTS, TIER_THRESHOLDS, OVERRIDES, EFFORT_RULES } from './policy.mjs'

// Network brains, by name. 'chain' tries config.router.brain first and falls
// back to the heuristic; a bare strategy name pins that brain with no fallback.
const BRAINS = { jev: jevRoute, systemone: systemoneRoute }

export async function route(request, context = {}, config = DEFAULT_CONFIG) {
  const strategy = (config && config.router && config.router.strategy) || 'chain'
  if (strategy === 'heuristic') return heuristicRoute(request, context, config)
  if (BRAINS[strategy]) return BRAINS[strategy](request, context, config)
  // chain: try the configured brain, fall back to the deterministic heuristic.
  const brainName = (config && config.router && config.router.brain) || 'jev'
  const brain = BRAINS[brainName] || jevRoute
  try {
    const decision = await brain(request, context, config)
    return { ...decision, strategy: 'chain', backend: brainName }
  } catch (err) {
    const fallback = heuristicRoute(request, context, config)
    return {
      ...fallback,
      strategy: 'chain',
      backend: 'heuristic',
      reason: `${fallback.reason} (brain unavailable: ${err && err.message ? err.message : err})`,
    }
  }
}

export function tierModel(decision, config = DEFAULT_CONFIG) {
  const tier = decision && decision.tier
  const model = config && config.tiers && config.tiers[tier]
  if (!model) throw new Error(`no model configured for tier "${tier}"`)
  return model
}

export function effortParams(decision, config = DEFAULT_CONFIG) {
  const effort = decision && decision.effort
  const params = config && config.effortMap && config.effortMap[effort]
  if (!params) throw new Error(`no effort params configured for effort "${effort}"`)
  return JSON.parse(JSON.stringify(params)) // deep clone: callers merge into request bodies
}

export function describeDecision(decision) {
  const lines = [
    'JEV Routing Decision',
    '',
    `  Tier        ${decision.tier}${decision.confidence !== undefined ? `   (${Math.round(decision.confidence * 100)}% confident)` : ''}`,
    `  Effort      ${decision.effort}`,
    `  Backend     ${decision.backend}  (strategy: ${decision.strategy})`,
    decision.latencyMs !== undefined ? `  Latency     ${decision.latencyMs}ms` : undefined,
    '',
    `  Reason      ${decision.reason}`,
  ].filter((l) => l !== undefined)
  if (decision.signals) {
    lines.push('', '  Signals')
    for (const key of Object.keys(decision.signals)) {
      const v = decision.signals[key]
      lines.push(`    ${key.padEnd(28)} ${typeof v === 'boolean' ? v : Number(v).toFixed(2)}`)
    }
  }
  return lines.join('\n')
}
