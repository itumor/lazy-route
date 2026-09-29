// jev-dsh — JEV Router as a DeepSeek Harness dynamic Cordis Plugin (Host half).
//
// This file is the reproducible source of the plugin defined in-session via
// cordis_define. Default-exported function body == the Package's code.host.
// Plain JavaScript only: no import/require/TS/JSX; only confirmed Builtins
// (ctx, harness, console) and Services fetched with ctx.get().
//
// What it does:
//   1. Listens to the `agent/request` waterfall: on step 0 of every turn,
//      if the agent's current route is the kimchi provider, asks a cheap
//      "brain" model (glm-5.3-flash) to classify the fresh user prompt into
//      {tier: haiku|sonnet|opus|fable, effort: low|medium|high|xhigh|max},
//      then replaces the call config's model + reasoningEffort accordingly.
//   2. Registers a dynamic model Tool `jev_route` so the agent can request
//      an explicit routing decision or inspect the last decisions.
//
// Failure policy: any error during routing leaves the original call config
// untouched — the router can never break the agent loop.

export default function plugin() {
  const PROVIDER_GATE = ['kimchi'] // providers whose calls JEV may re-route
  const BRAIN = { provider: 'kimchi', model: 'glm-5.3-flash' } // cheap, 7/7 on the local benchmark
  const TIER_MODELS = {
    haiku: 'glm-5.3-flash',      // $0.50/1M out, perfect score — the default
    sonnet: 'nemotron-3-ultra-fp4', // $2.20, 334 t/s, 7/7 — normal production work
    opus: 'glm-5.3',             // $4.00, quality anchor — deep reasoning
    fable: 'kimi-k3',            // $14.25, deepest reasoning — exceptional long-horizon
  }
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

  const ROUTER_PROMPT = [
    'You are JEV, a strict model router. Classify the task and reply with STRICT JSON ONLY:',
    '{"tier":"haiku|sonnet|opus|fable","effort":"low|medium|high|xhigh|max","confidence":0.0-1.0,"reason":"one short sentence"}',
    'Tiers: haiku = simple, deterministic, low-risk (extraction, formatting, lookups, trivial transforms).',
    'sonnet = normal production work (standard coding, debugging, research, moderate tool use).',
    'opus = complex work needing deep reasoning (architecture, gnarly debugging, high-stakes changes, subtle trade-offs).',
    'fable = exceptional long-horizon work (sustained autonomous multi-step execution, frontier difficulty).',
    'Effort: low = simple/latency-sensitive; medium = normal balanced; high = complex quality-first;',
    'xhigh = hardest long-running agentic work; max = absolute frontier problems only.',
    'Prefer the CHEAPEST sufficient tier and effort. Do not uprank for input length alone. JSON only, no prose.',
  ].join('\n')

  const lastUserTextByAgent = new Map() // agentId -> { turn, text }
  const recentDecisions = []            // ring buffer, cap 25
  let routingInFlight = false

  function extractText(content) {
    if (!Array.isArray(content)) return ''
    let out = ''
    for (const block of content) {
      if (block && block.type === 'text' && typeof block.text === 'string') out += (out ? '\n' : '') + block.text
      else if (block && block.type === 'tool-result') continue
    }
    return out
  }

  function parseDecision(raw) {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('no JSON object in router reply')
    const parsed = JSON.parse(raw.slice(start, end + 1))
    const tier = String(parsed.tier || '').toLowerCase()
    const effort = String(parsed.effort || '').toLowerCase()
    if (!(tier in TIER_MODELS)) throw new Error('invalid tier: ' + tier)
    if (!EFFORTS.includes(effort)) throw new Error('invalid effort: ' + effort)
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5))
    return {
      tier, effort, confidence,
      model: TIER_MODELS[tier],
      reason: String(parsed.reason || '').slice(0, 300),
    }
  }

  async function decide(llm, taskText, signal) {
    const messages = [{
      id: 'jev-route-user',
      role: 'user',
      content: [{ type: 'text', text: 'Task to route:\n' + String(taskText).slice(0, 6000) }],
      source: { kind: 'user' },
    }]
    let text = ''
    for await (const chunk of llm.stream({
      provider: BRAIN.provider,
      model: BRAIN.model,
      messages,
      system: ROUTER_PROMPT,
      temperature: 0,
      maxTokens: 600,
      signal,
    })) {
      if (chunk && chunk.type === 'text-delta') text += chunk.text
      if (chunk && chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') {
        throw new Error(chunk.reason.failure && chunk.reason.failure.message || 'router brain stream error')
      }
    }
    return parseDecision(text)
  }

  // Map a 5-level JEV effort onto the effort ids the target model actually supports.
  const effortCache = new Map() // model -> string[] ids
  async function mapEffort(llm, model, effort) {
    let ids = effortCache.get(model)
    if (!ids) {
      try {
        const info = await llm.resolveModelInfo(BRAIN.provider, model)
        ids = info && info.reasoning && Array.isArray(info.reasoning.efforts)
          ? info.reasoning.efforts.map((e) => String(e.id))
          : []
      } catch (err) { ids = [] }
      effortCache.set(model, ids)
    }
    if (ids.length === 0) return undefined
    const ordinal = EFFORTS.indexOf(effort)
    const idx = Math.round((ordinal / (EFFORTS.length - 1)) * (ids.length - 1))
    return ids[idx]
  }

  function remember(agentId, decision) {
    recentDecisions.push({ at: Date.now(), agentId: String(agentId), ...decision })
    if (recentDecisions.length > 25) recentDecisions.shift()
  }

  return {
    apply(ctx) {
      const llm = ctx.get('llm')
      if (llm === undefined) {
        console.log('jev: llm service unavailable, plugin idle')
        return
      }

      // Cache fresh user prompts per agent/turn so the request waterfall
      // (whose payload has no messages) can see what it is routing.
      ctx.on('agent/inbox/inserted', (payload) => {
        try {
          const text = extractText(payload.message && payload.message.content)
          if (text) lastUserTextByAgent.set(String(payload.agent.id), { turn: payload.turn, text })
        } catch (err) { console.error('jev: inbox cache failed', err) }
      })

      // The actual interception: replace frozen call config on turn starts.
      ctx.on('agent/request', async (payload, next) => {
        const config = await next()
        try {
          if (payload.step !== 0) return config
          if (!PROVIDER_GATE.includes(config.provider)) return config
          if (routingInFlight) return config
          const cached = lastUserTextByAgent.get(String(payload.agent.id))
          const text = cached && (cached.turn === payload.turn ? cached.text : cached.text)
          if (!text) return config
          routingInFlight = true
          const decision = await decide(llm, text, payload.signal)
          routingInFlight = false
          const reasoningEffort = await mapEffort(llm, decision.model, decision.effort)
          remember(payload.agent.id, { ...decision, provider: BRAIN.provider })
          console.log('jev: routed', decision.tier, decision.effort, '→', decision.model, '|', decision.reason)
          const nextConfig = { ...config, model: decision.model }
          if (reasoningEffort !== undefined) nextConfig.reasoningEffort = reasoningEffort
          return nextConfig
        } catch (err) {
          routingInFlight = false
          console.error('jev: routing failed, keeping original route', err)
          return config
        }
      })

      // Explicit model-visible router tool.
      const tool = harness.defineTool({
        name: 'jev_route',
        description: 'Ask the JEV Router to classify a task into capability tier (haiku/sonnet/opus/fable), effort (low..max), and the concrete kimchi model it maps to. Use before delegating work to pick the cheapest sufficient route. mode "route" needs task; "last" returns recent decisions; "config" returns the routing table.',
        parameters: { // note: parameter root must stay open (DSH constraint)
          type: 'object',
          properties: {
            task: { type: 'string', description: 'The task/prompt to classify (required for mode "route").' },
            mode: { type: 'string', enum: ['route', 'last', 'config'], description: 'route a task, show recent decisions, or show the routing table. Default: route.' },
          },
          required: [],
        },
        output: { // note: output root must explicitly declare additionalProperties
          schema: { type: 'object', additionalProperties: true },
          render(args, value) {
            return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
          },
        },
        async execute(args, exec) {
          const a = (args && typeof args === 'object') ? args : {}
          const mode = typeof a.mode === 'string' ? a.mode : 'route'
          if (mode === 'config') {
            return { providerGate: PROVIDER_GATE, brain: BRAIN, tierModels: TIER_MODELS, efforts: EFFORTS }
          }
          if (mode === 'last') {
            return { decisions: recentDecisions.slice(-10) }
          }
          if (typeof a.task !== 'string' || a.task.length === 0) {
            return { error: 'mode "route" requires a non-empty "task" string' }
          }
          try {
            const decision = await decide(llm, a.task, exec.signal)
            const reasoningEffort = await mapEffort(llm, decision.model, decision.effort)
            remember(exec.agent ? exec.agent.id : 'tool', { ...decision, provider: BRAIN.provider })
            return { ...decision, reasoningEffort: reasoningEffort === undefined ? null : reasoningEffort }
          } catch (err) {
            return { error: String(err && err.message || err) }
          }
        },
      })
      harness.registerTool(ctx, tool)

      console.log('jev: DSH router active — kimchi calls will be classified into', Object.keys(TIER_MODELS).join('/'))
    },
  }
}
