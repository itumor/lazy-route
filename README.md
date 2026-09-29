# lazy-route

**Local model + effort routing sidecar.** Every fresh user turn is classified
by the JEV questionnaire into a capability tier
(`haiku` / `sonnet` / `opus` / `fable`) and an effort level
(`low` / `medium` / `high` / `xhigh` / `max`), then the request is rewritten to
the cheapest sufficient model before it reaches the provider.

The router can never break your session: every interception has a deterministic
local heuristic fallback, every URL is configurable (including **local models**),
and credentials are forwarded, never stored.

> **aka `jev-router`.** The product/repo name is lazy-route; the internal
> prefix stays `jev` (`JEV_*` env vars, `~/.jev/router.json`, the
> `jev-routerd` daemon, `/jev/status` endpoints) so existing setups, scripts,
> and docs keep working unchanged.

```
Prompt ──► JEV Router ──► { model_tier, effort } ──► provider
             │
             ├─ heuristic  local, deterministic, offline
             ├─ jev        LLM call to ANY OpenAI-compatible endpoint
             └─ chain      jev with heuristic fallback (default)
```

## Claude compatibility (verified against real `claude` 2.1.278)

Real-binary testing found Claude Code substitutes *catalog* models before
dispatch — a bare `jev-router` alias does not reach the wire headlessly.
**Working mode**: alias the real model ids you use
(`JEV_ALIAS_MODELS="claude-opus-4-5,claude-sonnet-4-5,claude-haiku-4-5-20251001"`)
and every turn gets re-routed. Verified: subscription default `opus-4-5` was
rewritten to `haiku-4-5` on the wire for a trivial prompt; client-sent
`thinking` blocks are preserved by design. Full notes:
`docs/CLAUDE-REAL-BINARY-NOTES.md`. Desktop picker behavior is untested.

## Quickstart

```bash
# 1. start the routing sidecar
node daemon/jev-routerd.mjs                # http://127.0.0.1:38471

# 2a. Claude Code CLI — automatic; spawns the daemon if needed
node adapters/claude-cli/jev-claude.mjs
#    → Claude opens with a "JEV Router" model option; pick it once.

# 2b. Claude Code Desktop — merge the env block into settings
node adapters/claude-desktop/install.mjs --dry-run
node adapters/claude-desktop/install.mjs
#    → open Desktop → Code tab → select model "JEV Router".

# 2c. Codex — one routing decision per launch
node adapters/codex/jev-codex.mjs "migrate the test suite to vitest"

# 2d. DeepSeek Harness — dynamic Cordis Plugin (see adapters/dsh/README.md)

# 3. inspect / explain
curl -s localhost:38471/jev/status
node bin/jev-explain.mjs "rewrite the auth service for zero-downtime rotation"
```

## Configurable URLs — local models welcome

Everything is overridable via env, flags, or `~/.jev/router.json`:

| What              | Env var            | Default                      |
|-------------------|--------------------|------------------------------|
| Routing brain URL | `JEV_API_URL`      | `https://api.jev.dev/v1`     |
| Brain model       | `JEV_MODEL`        | `jev-router`                 |
| Upstream (routed-to) | `JEV_UPSTREAM_URL` | `https://api.anthropic.com`  |
| Strategy          | `JEV_STRATEGY`     | `chain` (`jev`/`heuristic`)  |
| Tier → model map  | `JEV_TIER_HAIKU` … | see `docs/ARCHITECTURE.md`   |

Route with a **local model** as the brain (Ollama example):

```json
// ~/.jev/router.json
{
  "jev": { "url": "http://localhost:11434/v1", "model": "qwen3:8b", "apiKey": "ollama" }
}
```

Or skip network brains entirely for fully-offline deterministic routing:

```bash
JEV_STRATEGY=heuristic node daemon/jev-routerd.mjs
```

## Why a sidecar and not an MCP server

MCP tools run **after** a model was already selected — too late to choose the
model. JEV must decide **before** execution, so interception lives in the
request path (loopback proxy for Claude/Codex, `agent/request` waterfall for
DSH). Plugins/MCP/skills are layered on top purely as UX (`/jev-status`,
`/jev-explain`, `jev_route` tool).

## Security

- Daemon binds **127.0.0.1 only** by default.
- `authorization` / `x-api-key` headers are forwarded byte-identically and never
  logged or stored (test-enforced in `tests/daemon.test.mjs`).
- `JEV_API_KEY` is read from env/config only and redacted from `/jev/status`.

## Tests

```bash
npm test            # core + daemon + adapters, all on loopback stub servers
```

## Layout

See `docs/ARCHITECTURE.md` — the frozen contract between `core/`, `daemon/`,
and `adapters/` (claude-cli, claude-desktop, codex, dsh) plus `plugin/`
(Claude plugin UX: `/jev-status`, `/jev-explain`, `/jev-models`).

## Roadmap

- [x] Claude Code CLI (loopback proxy)
- [x] Claude Code Desktop — local sessions (env editor + settings installer)
- [x] Codex CLI (launch-time decision)
- [x] DeepSeek Harness (in-band Cordis plugin, kimchi-routed)
- [ ] Claude Desktop `.mcpb` extension (config UX + encrypted key storage)
- [ ] Per-turn routing for Claude Chat / remote Code sessions (needs a
      gateway-style deployment, not loopback)
