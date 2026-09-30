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

## Claude Desktop (verified 2026-09-30, Desktop 2.16120.0, bundled claude 2.1.284)

**Result: Code-tab local sessions cannot be routed via settings.** Evidence:

1. Live Desktop session env: `ANTHROPIC_BASE_URL=https://api.anthropic.com`,
   `CLAUDE_CODE_ENTRYPOINT=claude-desktop`, `--model claude-opus-5-5` — while
   `~/.claude/settings.json` had `ANTHROPIC_BASE_URL=http://127.0.0.1:38471`.
   `lsof` on the session pid: all API sockets to `160.79.104.10:443`, zero to 38471.
2. Desktop app (`app.asar`) builds spawn env with `ANTHROPIC_BASE_URL: apiHost`,
   hard-coded `https://api.anthropic.com` for production 1P accounts. Only the
   3P provider's `apiHostOverride()` (`creds.baseUrl`, org-managed gateway mode)
   changes it.
3. Bundled CLI: when `CLAUDE_CODE_ENTRYPOINT` is a desktop host,
   `hostSpawnEnvKeys = Object.keys(process.env)` and every settings source
   (user, `--settings` flag, policy) is filtered against it — host env wins.
4. Real-binary E2E (loopback stubs, real installer, real daemon):

   | Case | `/v1/messages` went to |
   |------|------------------------|
   | `CLAUDE_CODE_ENTRYPOINT=claude-desktop` + installer settings.json | DIRECT (router bypassed) |
   | same + `--settings '{"env":{"ANTHROPIC_BASE_URL":…}}'` | DIRECT (router bypassed) |
   | `CLAUDE_CODE_ENTRYPOINT=cli` + installer settings.json | ROUTED, `claude-opus-4-5 → claude-haiku-4-5` |

5. Desktop model picker (`set_session_model` valid-id list) has no `jev-router`
   row even though `ANTHROPIC_CUSTOM_MODEL_OPTION` reaches the session env.

Also fixed from this run: Claude Code puts KBs of `<system-reminder>` blocks in
the user turn; the daemon now strips them before routing (before the fix,
"say hi" routed as `opus/high`).

## CLI launcher (verified 2026-09-30, claude 2.1.285)

`adapters/claude-cli/jev-claude.mjs` end-to-end, real binary:

- Loopback stub: `--model claude-opus-4-5` + "say hi" → wire `claude-haiku-4-5`;
  hard auth-rotation prompt → stays `claude-opus-4-5`; `--model jev-router` →
  wire `claude-haiku-4-5`; `--model claude-opus-5-5` (not aliased) → passthrough.
- Real api.anthropic.com, subscription OAuth via loopback: `--model jev-router`
  "say hi" → exit 0, API-reported model `claude-haiku-4-5-20251001`.
- **Alias reaches the wire again in 2.1.285.** `[claude-code:unrecognized_model]`
  still prints, but the request carries `jev-router` (2.1.278 substituted it).
- Terminal `claude` (non-host) applies `~/.claude/settings.json` env *over* the
  launcher's process env, so a settings `ANTHROPIC_BASE_URL` wins over `JEV_PORT`.

## Open verification items

- Interactive CLI picker row created by `ANTHROPIC_CUSTOM_MODEL_OPTION`.
- A future `router.interceptMode: "user-turn"` in the daemon to route any
  fresh user turn without aliasing (identify turns whose final message is a
  user text message, not a tool_result continuation).
