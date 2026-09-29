// core/policy.mjs — deterministic signals → (tier, effort) policy.
// This is the ONLY place tier/effort thresholds live; both the heuristic and
// the LLM-brain strategies funnel signals through decide().

import { SCORE_KEYS } from './questionnaire.mjs'

export const TIERS = Object.freeze(['haiku', 'sonnet', 'opus', 'fable'])
export const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])
export const TIER_ORDER = Object.freeze({ haiku: 0, sonnet: 1, opus: 2, fable: 3 })
export const EFFORT_ORDER = Object.freeze({ low: 0, medium: 1, high: 2, xhigh: 3, max: 4 })

// Relative importance of each 0..1 score signal (normalized internally).
// Rationale: intrinsic complexity and planning dominate; reversibility is
// inverted (hard-to-reverse work deserves upranking); ambiguity matters least
// because clarification beats horsepower.
export const WEIGHTS = Object.freeze({
  task_complexity: 0.25,
  ambiguity: 0.08,
  tool_complexity: 0.10,
  execution_depth: 0.12,
  verification_difficulty: 0.10,
  specialized_expertise: 0.12,
  failure_recovery_complexity: 0.07,
  context_complexity: 0.08,
  planning_required: 0.12,
  reversibility: 0.06, // applied to (1 - reversibility)
  novelty: 0.10,
})

// Tier boundaries on the weighted-mean aggregate S in [0,1], calibrated against
// the routing matrix in tests: trivial asks land ≈0.04–0.11, moderate
// engineering ≈0.19–0.45, deep work ≈0.5–0.75, frontier long-horizon ≈0.9+.
export const TIER_THRESHOLDS = Object.freeze({ haiku: 0.12, sonnet: 0.45, opus: 0.75 })

// Escalation overrides (applied after the weighted mean).
export const OVERRIDES = Object.freeze({
  stakesMinTier: 'opus',     // high_stakes or novelty >= 0.8 → at least opus
  noveltyCutoff: 0.8,
  horizonTier: 'fable',      // long_horizon && execution_depth >= 0.8 → fable
  horizonDepthCutoff: 0.8,
})

// Effort = clamp(TIER_ORDER[tier] + adjustment, 0..4) where
//   adjustment = +1 if execution_depth >= 0.8
//              +1 if long_horizon
//              -1 if the task is uniformly light (complexity < 0.4,
//                 verification < 0.3, not high_stakes, not long_horizon)
export const EFFORT_RULES = Object.freeze({
  deepCutoff: 0.8,
  lightComplexityCutoff: 0.4,
  lightVerificationCutoff: 0.3,
})

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

export function aggregate(signals) {
  let weighted = 0, total = 0
  for (const key of SCORE_KEYS) {
    const w = WEIGHTS[key]
    if (!w) continue
    const raw = Number(signals[key])
    const s = Number.isFinite(raw) ? clamp(raw, 0, 1) : 0
    weighted += w * (key === 'reversibility' ? 1 - s : s)
    total += w
  }
  return total === 0 ? 0 : weighted / total
}

export function decide(signals) {
  const s = aggregate(signals)
  let tierIndex =
    s < TIER_THRESHOLDS.haiku ? 0 :
    s < TIER_THRESHOLDS.sonnet ? 1 :
    s < TIER_THRESHOLDS.opus ? 2 : 3

  if ((signals.high_stakes === true) || (Number(signals.novelty) || 0) >= OVERRIDES.noveltyCutoff) {
    tierIndex = Math.max(tierIndex, TIER_ORDER[OVERRIDES.stakesMinTier])
  }
  if (signals.long_horizon === true && (Number(signals.execution_depth) || 0) >= OVERRIDES.horizonDepthCutoff) {
    tierIndex = Math.max(tierIndex, TIER_ORDER[OVERRIDES.horizonTier])
  }

  let adjustment = 0
  if ((Number(signals.execution_depth) || 0) >= EFFORT_RULES.deepCutoff) adjustment += 1
  if (signals.long_horizon === true) adjustment += 1
  const light =
    (Number(signals.task_complexity) || 0) < EFFORT_RULES.lightComplexityCutoff &&
    (Number(signals.verification_difficulty) || 0) < EFFORT_RULES.lightVerificationCutoff &&
    signals.high_stakes !== true && signals.long_horizon !== true
  if (light) adjustment -= 1

  const effortIndex = clamp(tierIndex + adjustment, 0, EFFORTS.length - 1)
  return { tier: TIERS[tierIndex], effort: EFFORTS[effortIndex], aggregate: s }
}

// Confidence: distance from the nearest tier boundary, squashed to [0.5, 0.99].
export function confidenceFor(s, tier) {
  const bounds = [TIER_THRESHOLDS.haiku, TIER_THRESHOLDS.sonnet, TIER_THRESHOLDS.opus]
  const nearest = bounds.reduce((d, b) => Math.min(d, Math.abs(s - b)), Infinity)
  return clamp(0.5 + nearest * 2, 0.5, 0.99)
}
