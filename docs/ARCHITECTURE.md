# JEV Router — Architecture & Module Contracts

This document is the **frozen contract** between `core/`, `daemon/`, `adapters/`, and `plugin/`.
All packages are pure ESM JavaScript, Node >= 20, **zero runtime dependencies** (node builtins + global `fetch` only).

## Concept

```
Prompt ──► JEV Router ──► { model_tier, effort } ──► upstream provider
             │
             ├─ strategy "heuristic"  (local, deterministic, always available)
             ├─ strategy "jev"        (calls configured LLM endpoint with the questionnaire)
             └─ strategy "chain"      (jev with heuristic fallback) ← default
```

Tiers: `haiku` < `sonnet` < `opus` < `fable`. Efforts: `low` < `medium` < `high` < `xhigh` < `max`.

**Configurability is a first-class feature:** every URL is overridable — the JEV routing endpoint may be api.jev.dev, any OpenAI-compatible API, or a **local model** (Ollama `http://localhost:11434/v1`, LM Studio, llama.cpp). The upstream (the thing routed *to*) is also overridable.

## Directory layout

```
core/        questionnaire, decision engine, config loader, strategies   (pure logic, no sockets, no disk except config file reads)
daemon/      jev-routerd: loopback HTTP proxy + control endpoints
adapters/
  claude-cli/      jev-claude launcher (spawns CLI with ANTHROPIC_BASE_URL + custom model option)
  claude-desktop/  settings/env generator + installer for Claude Code Desktop local sessions
  codex/           jev-codex launcher (asks router for model once, then launches codex -m)
  dsh/             DeepSeek Harness dynamic Cordis plugin source (documented, defined in-session)
plugin/      Claude Desktop/CLI plugin: /jev-* skills + hooks (config UX only, NOT the interception path)
docs/        this file + guides
tests/       node:test suites; E2E uses real loopback servers on ephemeral ports
bin/         shared CLI helpers (jev-explain)
```

Question routing in *this build* is done by **sub-agents**: treat this document as the only source of truth for cross-module signatures.

---

## core/index.mjs — frozen exports

```js
export { QUESTIONNAIRE }        // the routing questionnaire (see core/questionnaire.mjs)
export { TIERS, EFFORTS, TIER_ORDER, EFFORT_ORDER }
export async function loadConfig(overrides = {}, env = process.env, homeDir = os.homedir()) -> Config
export function heuristicRoute(request, context = {}, config = DEFAULT_CONFIG) -> Decision
export async function jevRoute(request, context = {}, config = DEFAULT_CONFIG) -> Decision   // network call; throws on failure
export async function route(request, context = {}, config = DEFAULT_CONFIG) -> Decision      // strategy from config.strategy, "chain" default: jevRoute, on error falls back to heuristicRoute
export function tierModel(decision, config) -> string       // resolve tier → concrete model id
export function effortParams(decision, config) -> object    // effort → request fields to merge (e.g. { thinking: {...} } or output_config)
export function describeDecision(decision) -> string        // pretty multi-line explanation for /jev-explain
```

### Config shape (loadConfig merge order: DEFAULTS ← file ← env ← overrides)

```js
{
  jev: {
    url: "https://api.jev.dev/v1",     // JEV_API_URL — routing brain endpoint (OpenAI-compatible /chat/completions)
    apiKey: "",                        // JEV_API_KEY (never committed; env only)
    model: "jev-router",               // JEV_MODEL — model used for the routing decision itself
    timeoutMs: 8000,                   // JEV_TIMEOUT_MS
  },
  upstream: {
    url: "https://api.anthropic.com",  // JEV_UPSTREAM_URL — where routed requests go
  },
  daemon: {
    host: "127.0.0.1",                 // JEV_HOST
    port: 38471,                        // JEV_PORT
  },
  router: {
    strategy: "chain",                  // JEV_STRATEGY: chain | jev | heuristic
    aliasModels: ["jev-router"],        // model ids that trigger interception (JEV_ALIAS_MODELS, comma-separated)
  },
  tiers: {                              // tier → concrete upstream model id (JEV_TIER_HAIKU... env overrides)
    haiku: "claude-haiku-4-5",
    sonnet: "claude-sonnet-4-5",
    opus: "claude-opus-4-5",
    fable: "claude-opus-4-5",           // frontier slot; maps to strongest until a dedicated model exists
  },
  effortMap: {                          // effort → Anthropic request fields
    low:    { thinking: { type: "enabled", budget_tokens: 1024 } },
    medium: { thinking: { type: "enabled", budget_tokens: 4096 } },
    high:   { thinking: { type: "enabled", budget_tokens: 16384 } },
    xhigh:  { thinking: { type: "enabled", budget_tokens: 32768 } },
    max:    { thinking: { type: "enabled", budget_tokens: 65536 } },
  },
}
```

Config file: `${JEV_CONFIG || ~/.jev/router.json}` (JSON, deep-merged over defaults). Local-model example:

```json
{ "jev": { "url": "http://localhost:11434/v1", "model": "qwen3:8b", "apiKey": "ollama" } }
```

### Decision shape (must be JSON-serializable)

```js
{
  tier: "sonnet",                 // one of TIERS
  effort: "medium",               // one of EFFORTS
  confidence: 0.82,               // 0..1
  strategy: "chain",              // strategy actually used
  backend: "heuristic" | "jev",   // which brain produced it
  signals: {                      // questionnaire scores, 0..1 each unless noted
    task_complexity: 0.4, ambiguity: 0.2, underspecified: false, high_stakes: false,
    requires_tools: true, tool_complexity: 0.4, execution_depth: 0.5, long_horizon: false,
    verification_difficulty: 0.4, specialized_expertise: 0.5, failure_recovery_complexity: 0.3,
    context_complexity: 0.4, planning_required: 0.5, reversibility: 0.9, novelty: 0.3,
  },
  reason: "one-paragraph human-readable rationale",
  latencyMs: 12,                  // routing decision latency
}
```

Threshold policy (deterministic, lives in core/policy.mjs, unit-tested):
weighted aggregate `S = Σ weight_i · signal_i` with booleans contributing as 0/1;
tier = S < 0.25 ? haiku : S < 0.5 ? sonnet : S < 0.75 ? opus : fable,
with overrides: `high_stakes || novelty ≥ 0.8` lifts tier to ≥ opus; `long_horizon && execution_depth ≥ 0.8` lifts to fable;
effort = clamp(tierIndex + adjustment, low..max) where adjustment comes from execution_depth/long_horizon — documented precisely by the core author with tests pinning the matrix.

---

## daemon/jev-routerd.mjs — behavior contract

- Listens on `config.daemon.host:port`; `--config`, `--port`, `--jev-url`, `--upstream-url` flags override.
- `GET /health` → 200 `{"ok":true, "version": ..., "strategy": ...}`
- `GET /jev/status` → 200: config summary (secrets redacted: apiKey → `"***"` when set)
- `POST /jev/route` `{ request, context? }` → 200 Decision JSON (dry run, no forwarding) — used by adapters + tests
- `POST /v1/messages` (and any other path):
  - If body.model ∈ `config.router.aliasModels`: extract the **last user turn** text (messages array, role user, string or content-block list of text blocks) → `route()` → replace `model` with `tierModel(decision)`, merge `effortParams(...)` unless body already sets those fields.
  - Always add response header `x-jev-tier`, `x-jev-effort`, `x-jev-backend` for observability.
  - Forward to `${config.upstream.url}${originalPath}` streaming request and response bodies byte-faithfully (SSE passthrough, no buffering of stream bodies; non-stream JSON OK to buffer).
  - Pass through all client headers except hop-by-hop (`host`, `content-length`, `connection` recomputed). **Never inspect, log, or mutate `authorization` / `x-api-key`.**
- Process exit code 0 on `--help`, non-zero with clear stderr on config errors.

## adapters contracts

### claude-cli/jev-claude.mjs
Checks `GET http://host:port/health` (2s timeout); if down, spawns routerd detached and waits for health (≤5s), then spawns `claude` with inherited stdio and env:
`ANTHROPIC_BASE_URL=http://host:port`, `ANTHROPIC_CUSTOM_MODEL_OPTION=jev-router`, `ANTHROPIC_CUSTOM_MODEL_OPTION_NAME=JEV Router`, `ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION=Auto model+effort routing`. Forwards exit code.

### claude-desktop/
- `config.mjs` `export function desktopEnv(config)` → the env block object above (for the Desktop env editor)
- `install.mjs` patches `~/.claude/settings.json` (creates/backs-up, merges `env` key without clobbering others) and prints next-step instructions. Dry-run with `--dry-run`.

### codex/jev-codex.mjs
`jev-codex [args...]`: `POST /jev/route` with the joined prompt args (or stdin when piped), then `spawn("codex", ["-m", tierModel(decision), ...args])`. Alias of step-behind simplicity: one routing decision per launch.

### dsh/
`README.md` + `jev-dsh.plugin.mjs` documenting/containing the dynamic Cordis plugin source defined in-session this build (ker: Tool `jev_route`, subagent routing table).

## plugin/ (Claude plugin, UX only)

`.claude-plugin/plugin.json`, `skills/jev-status.md`, `skills/jev-explain.md`, `skills/jev-models.md` — tiny skills that call `curl localhost:port/jev/status` / `/jev/route`. Hooks: none that mutate traffic (unsupported); only a SessionStart health ping.

## tests/ conventions

- `node:test` + `node:assert/strict`, all E2E servers bound to `127.0.0.1:0`.
- Every adapter/unit test must construct its own config object (never rely on user env leaking in: pass explicit `env = {}` / overrides).
- No network outside loopback in tests. Mock JEV = tiny OpenAI-compatible stub server; mock upstream = stub Anthropic server asserting rewritten model/effort + returning canned SSE + JSON.

## Security invariants (test-enforced)

1. `authorization`/`x-api-key` headers are forwarded untouched and never logged.
2. `jev.apiKey` is redacted from `/jev/status`.
3. Daemon binds loopback only by default.
