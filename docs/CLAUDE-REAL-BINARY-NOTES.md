# Claude Code real-binary findings (verified 2026-09-…, Claude Code 2.1.278)

These notes record what we verified against the ACTUAL `claude` binary, not stubs.

## Verified end-to-end (real binary → jev-routerd → mock upstream, auth present)

1. **Passthrough works**: `/api/hello` and `/v1/messages?beta=true` forward with
   `authorization` intact; responses stream back fine.
2. **Interception works**: with `JEV_ALIAS_MODELS` covering the model Claude
   actually sends, the daemon rewrote the on-the-wire model
   (`claude-opus-4-5` → `claude-haiku-4-5-*` for a trivial prompt under the
   heuristic strategy) and preserved the client's explicit `thinking` block
   (budget 31999 — client precedence is by design).

## The surprise: alias models no longer reach the wire

Claude Code 2.1.278 validates model names against its catalog **before
dispatch**. `ANTHROPIC_MODEL=jev-router` (or `--model jev-router`) prints
`[claude-code:unrecognized_model]` and the outgoing calls substitute catalog
models (observed: `claude-sonnet-4-5` main / `claude-haiku-4-5-20251001`
background). `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1` silences
the console warning but does NOT restore alias delivery.

Consequences:

- The original jev-router design ("select the `jev-router` row in the picker,
  the alias flows to the proxy") does **not** currently reach the wire in this
  version — via env/CLI flags. (The interactive picker row created by
  `ANTHROPIC_CUSTOM_MODEL_OPTION` may still pass the alias through when the row
  is selected by hand; that picker path is **unverified** — see README.)
- **Working strategy for CLI headless/print mode**: put Claude's *real* model
  ids into `JEV_ALIAS_MODELS` (e.g. your subscription default
  `claude-opus-4-5`, plus `claude-sonnet-4-5`, `claude-haiku-4-5-*`), so every
  turn is re-routed by JEV:

```bash
JEV_ALIAS_MODELS="claude-opus-4-5,claude-sonnet-4-5,claude-haiku-4-5-20251001" \
  node daemon/jev-routerd.mjs
```

- Client-sent `thinking` blocks are **preserved** (client precedence). If you
  want JEV effort to also control thinking when the client already sets one,
  strip client thinking before launch (e.g. `CLAUDE_CODE_EFFORT_LEVEL` /
  thinking-related env off) or accept the client's.

## Recommended default launcher profile

`adapters/claude-cli/jev-claude.mjs` should therefore default its alias env to
the known catalog ids rather than only `jev-router`:

```bash
JEV_ALIAS_MODELS="${JEV_ALIAS_MODELS:-claude-opus-4-5,claude-sonnet-4-5,claude-haiku-4-5-20251001}" 
```

## Open verification items

- Claude Code **Desktop** picker row visibility/behavior (manual check needed).
- Interactive CLI picker row created by `ANTHROPIC_CUSTOM_MODEL_OPTION`.
- A future `router.interceptMode: "user-turn"` in the daemon to route any
  fresh user turn without aliasing (identify turns whose final message is a
  user text message, not a tool_result continuation).
