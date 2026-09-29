# JEV Router — DeepSeek Harness (DSH) adapter

JEV inside DSH is **not a proxy**: DSH exposes a proper in-band interception point,
the `agent/request` waterfall event, so the router replaces the frozen call
configuration (model + reasoning effort) *before* the model call is dispatched.

## How it works

```
user prompt
   │
   ▼
agent/inbox/inserted  ──► cache prompt text per agent/turn
   │
   ▼
agent/request (step 0, waterfall)
   │  if config.provider ∉ PROVIDER_GATE → pass through untouched
   │  else:
   ▼
brain call: kimchi/glm-5.3-flash  (cheap, temperature 0)
   │  classifies into { tier, effort, confidence, reason }
   ▼
LlmCallConfig rewritten: model = TIER_MODELS[tier], reasoningEffort mapped
   ▼
provider dispatch
```

Failure of any routing step returns the original config — the router can never
break the agent loop.

## Routing table (kimchi, benchmark-grounded)

| tier   | effort used          | model                    | why                                  |
|--------|----------------------|--------------------------|--------------------------------------|
| haiku  | low                  | `glm-5.3-flash`          | 7/7 benchmark, $0.50/1M out          |
| sonnet | medium               | `nemotron-3-ultra-fp4`   | 7/7, 334 t/s speed king              |
| opus   | high                 | `glm-5.3`                | quality anchor, strongest math       |
| fable  | xhigh/max            | `kimi-k3`                | deepest reasoning (40× flash price)  |

Effort levels `low`/`medium`/`high`/`xhigh`/`max` are mapped proportionally onto
the effort ids the target model actually advertises (`resolveModelInfo`); when a
model exposes no effort list, the effort field is left untouched (current kimchi
behavior) and tier/model mapping is the cost lever.

## Files

- `jev-dsh.plugin.mjs` — single source of truth for the Package's `code.host`.
  The default-exported function body is pasted verbatim into `cordis_define`.

## Installing in a DSH session

1. Read the function body from `jev-dsh.plugin.mjs` (everything inside
   `export default function plugin() { ... }`).
2. `cordis_define` with the body as `code.host`, then `cordis_run`.
3. Optional: the registered model Tool `jev_route` supports
   `mode: "route" | "last" | "config"`.

## Limits

- Dynamic Plugins are process-local: they vanish on DSH restart and must be
  re-defined per session.
- The router gates on provider id (`kimchi` by default); calls through other
  providers pass through unmodified by design.
- Subagent delegations are agents too, so their step-0 calls are routed the
  same way — the brain itself runs on `glm-5.3-flash` regardless.
