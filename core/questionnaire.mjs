// core/questionnaire.mjs — the frozen JEV routing questionnaire.
// A brain (LLM endpoint or the deterministic heuristic) answers these fields
// with signals; core/policy.mjs turns signals into a final tier+effort.

export const QUESTIONNAIRE = Object.freeze({
  model_tier: {
    type: 'choice',
    instructions: 'Choose the cheapest model tier likely to complete the request correctly and reliably. Consider reasoning complexity, ambiguity, specialized knowledge, tool usage, execution depth, verification difficulty, risk of failure, and whether sustained long-horizon reasoning is required. Prefer the cheaper tier whenever it is sufficient. Do not select a stronger model merely because the input is long.',
    criteria: {
      haiku: 'Simple, deterministic, low-risk tasks requiring little reasoning: extraction, classification, formatting, straightforward transformations, simple file operations, basic lookups, short predictable tool calls.',
      sonnet: 'Normal production work requiring meaningful reasoning: software development, standard debugging, research, analysis, multiple tool calls, moderate ambiguity, code changes, most agentic workflows.',
      opus: 'Complex work requiring deep reasoning or technical judgment: difficult debugging, architecture design, unfamiliar systems, complex root-cause analysis, high-risk changes, subtle trade-offs, substantial multi-step planning.',
      fable: 'Exceptionally difficult or long-horizon work: sustained reasoning, complex planning, extensive state tracking, repeated tool interaction, difficult recovery, exceptionally challenging problems where opus may not be sufficient.',
    },
  },
  effort: {
    type: 'choice',
    instructions: 'Choose the lowest effort level likely to complete the task reliably. Increase effort only when additional reasoning depth or sustained execution is likely to materially improve the result.',
    criteria: {
      low: 'Simple, well-specified, latency-sensitive, or high-volume tasks: chat, extraction, classification, simple transformations, small code changes, lightweight subagents.',
      medium: 'Normal production tasks: balanced speed/cost/capability — standard coding, moderate reasoning, several tool calls, normal debugging, well-specified agentic workflows.',
      high: 'Complex reasoning, difficult coding, substantial debugging, architecture work, multi-step tool use, agentic tasks where quality beats speed/cost.',
      xhigh: 'The hardest coding and agentic workloads: long-running tasks with sustained reasoning, repeated tool calls, extensive state tracking, exploration, replanning.',
      max: 'Only when absolute highest capability is required and token efficiency is no constraint: frontier problems, exceptionally difficult reasoning, maximum thoroughness.',
    },
  },
  task_complexity: { type: 'score', instructions: 'Intrinsic reasoning/technical complexity of completing the request. Judge actual work, not prompt length.', criteria: ['Simple: mechanical, deterministic, obvious solution.', 'Moderate: several reasoning steps, normal engineering judgment.', 'Complex: deep reasoning, architecture, difficult debugging, substantial analysis.', 'Extreme: many interacting constraints, novel problems, sustained planning, extensive exploration.'] },
  ambiguity: { type: 'score', instructions: 'How ambiguous is the request — multiple plausible interpretations, decisions to infer.', criteria: ['Clear: action and result explicit.', 'Some ambiguity: a few details need reasonable interpretation.', 'High ambiguity: important requirements must be inferred.', 'Extreme ambiguity: substantially different interpretations possible, wrong choice materially affects result.'] },
  underspecified: { type: 'noul', instructions: 'Is important information missing that prevents reliable completion without guessing?', criteria: { true: 'Critical context, requirements, permissions, identifiers, paths, constraints, or expected behavior missing.', false: 'Enough information available, or minor gaps resolvable during execution.' } },
  high_stakes: { type: 'noul', instructions: 'Could an incorrect answer or action reasonably cause meaningful production, security, financial, privacy, compliance, availability, or data-loss impact?', criteria: { true: 'Wrong decision or action could have meaningful real-world consequences.', false: 'Errors limited, easy to detect, reverse, or correct.' } },
  requires_tools: { type: 'noul', instructions: 'Does success require interaction with external tools or systems rather than text reasoning alone?', criteria: { true: 'Requires files, repositories, terminals, APIs, databases, browsers, cloud services, applications, or other external systems.', false: 'Completable entirely through reasoning and text generation.' } },
  tool_complexity: { type: 'score', instructions: 'Complexity of required tool interaction. Lowest when no tools required.', criteria: ['None or trivial: no tools or a single predictable operation.', 'Moderate: several straightforward tool calls with limited dependencies.', 'Complex: multiple dependent tools, changing state, validation, branching on results.', 'Extreme: extensive orchestration across systems with retries, recovery, state management, or destructive operations.'] },
  execution_depth: { type: 'score', instructions: 'Sequential execution, planning, and state tracking required end-to-end.', criteria: ['Shallow: one action or very short deterministic sequence.', 'Moderate: several dependent actions or validation steps.', 'Deep: many dependent steps with planning, iteration, state tracking.', 'Long-horizon: extensive execution with evolving state, repeated decisions, testing, recovery, many tool interactions.'] },
  long_horizon: { type: 'noul', instructions: 'Does the task require sustained autonomous execution over a long dependent chain where intermediate results materially influence later decisions?', criteria: { true: 'Prolonged planning and execution with substantial state tracking, adaptation, or repeated tool interaction.', false: 'Bounded task, completable in a relatively short sequence.' } },
  verification_difficulty: { type: 'score', instructions: 'How hard is it to determine the final result is actually correct?', criteria: ['Easy: correctness obvious or mechanically verifiable.', 'Moderate: normal testing, review, or cross-checking.', 'Difficult: substantial testing, investigation, or expert judgment.', 'Very difficult: uncertain even after testing; needs extensive validation, simulation, or specialist judgment.'] },
  specialized_expertise: { type: 'score', instructions: 'Specialized domain or technical expertise required.', criteria: ['General: basic knowledge suffices.', 'Professional: normal competence in the domain.', 'Expert: deep specialist knowledge, nuanced judgment.', 'Exceptional: highly specialized expertise across multiple advanced domains or novel reasoning.'] },
  failure_recovery_complexity: { type: 'score', instructions: 'If an attempt fails, how difficult is diagnosis and recovery?', criteria: ['Easy: retry or correction straightforward.', 'Moderate: some investigation and corrective action.', 'Complex: multiple possible causes, substantial diagnosis or rollback.', 'Extreme: cascading failures, sophisticated recovery, hard-to-diagnose partial state.'] },
  context_complexity: { type: 'score', instructions: 'Difficulty of understanding and maintaining relevant context. Judge relationships, not length.', criteria: ['Simple: very little context, few dependencies.', 'Moderate: several facts, files, components, or dependencies together.', 'Complex: many interconnected components, requirements, documents, constraints.', 'Extreme: very large, highly interconnected context across systems, artifacts, or stages.'] },
  planning_required: { type: 'score', instructions: 'Explicit planning required before and during execution.', criteria: ['None: correct action immediately apparent.', 'Moderate: short plan or ordering useful.', 'Substantial: alternatives and dependencies evaluated and coordinated.', 'Extensive: strategic planning, decomposition, replanning, adaptation on intermediate results.'] },
  reversibility: { type: 'score', instructions: 'How easy to reverse or correct an incorrect action?', criteria: ['Fully reversible: mistakes immediately and safely undone.', 'Mostly reversible: correction possible with limited effort or impact.', 'Difficult to reverse: rollback requires meaningful work or disruption.', 'Potentially irreversible: permanent loss, external consequences, extremely hard to restore.'] },
  novelty: { type: 'score', instructions: 'How novel or unfamiliar versus common established tasks and patterns?', criteria: ['Routine: common problem, established patterns.', 'Some novelty: adapting known patterns.', 'Highly novel: established solutions do not directly apply, substantial reasoning needed.', 'Frontier: unusual or unprecedented, exploration or invention without a clear established solution.'] },
})

// Signals the policy consumes, in canonical order.
export const SCORE_KEYS = Object.freeze([
  'task_complexity', 'ambiguity', 'tool_complexity', 'execution_depth',
  'verification_difficulty', 'specialized_expertise', 'failure_recovery_complexity',
  'context_complexity', 'planning_required', 'reversibility', 'novelty',
])
export const BOOL_KEYS = Object.freeze([
  'underspecified', 'high_stakes', 'requires_tools', 'long_horizon',
])
export const SIGNAL_KEYS = Object.freeze([...SCORE_KEYS, ...BOOL_KEYS])
