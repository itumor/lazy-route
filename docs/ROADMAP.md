# lazy-route — Improvement Roadmap

Target: `lazy-route` (aka `jev-router`) v0.1.0 — local model+effort routing sidecar.
Baseline reviewed: branch `feat/systemone-brain`, 50/50 tests green, adapters for
Claude CLI / Codex / DSH shipped, System One brain just landed.

Priorities: **P0** = do now (cheap, unblocks everything) · **P1** = product core ·
**P2** = reach & distribution · **P3** = later. Effort: S < half day, M ≈ 1–2 days, L ≈ 3+ days.

---

## Where we are (snapshot)

| Area | State |
|---|---|
| Core engine (`core/`) | ✅ questionnaire → policy → tier/effort, 3 brains (heuristic, jev, systemone), chain fallback |
| Daemon (`daemon/`) | ✅ loopback proxy, alias interception, SSE passthrough, secrets test-enforced |
| Adapters | ✅ claude-cli, claude-desktop installer, codex (launch-time), dsh (Cordis plugin) |
| Tests | ✅ 50 passing (core 16, daemon 13, systemone 13, adapters 8), loopback-only |
| Docs | ✅ ARCHITECTURE.md frozen contract, real-binary Claude notes |
| ❌ Gaps | no LICENSE file, no CI, no CHANGELOG, unmerged feature branch, no decision log/metrics/cache in the daemon, two divergent routing brains (core vs DSH plugin) |

---

## Phase 0 — Repo foundations (P0, ~1 day total)

- [ ] **Merge `feat/systemone-brain` → `main`.** The latest work (System One brain, tier-map fix) sits on a side branch while `main` is behind. Merge after green CI (below). *(S)*
- [ ] **Add LICENSE (MIT).** `package.json` declares `"license": "MIT"` but no LICENSE file exists — legally the repo is "all rights reserved" right now. *(S)*
- [ ] **Add CI.** `.github/workflows/ci.yml`: matrix Node 20/22, `npm test`. Every future PR then proves the 50-test suite stays green. *(S)*
- [ ] **CHANGELOG.md** — start with `0.1.0` (core engine, daemon, 4 adapters, System One brain). Keep a Keep-a-Changelog format. *(S)*
- [ ] **Repo hygiene.** Delete merged stale branches + worktrees (`claude/desktop-visibility-issue-*`, `claude/jefrouter-claude-desktop-*` — PR #1 is merged); decide tracked-vs-ignored for `marketing/` and `.memsearch/`. *(S)*
- [ ] **Single source of version.** `daemon/server.mjs` hardcodes `VERSION = '0.1.0'` next to `package.json`. Read version from `package.json` (createRequire) or a generated constant. *(S)*
- [ ] **Docs tidy.** Move `gif-alternatives-research.md` + `jev-alternatives-research.md` into `docs/research/`; they bury the two contract docs that matter. *(S)*

**Exit criteria:** `main` == feature branch, LICENSE + CI + CHANGELOG exist, fresh clone passes tests on Node 20 and 22 in CI.

---

## Phase 1 — Routing quality & observability (P1, the product core)

### 1a. Observability: decisions become inspectable *(M)*

Today a decision exists only as `x-jev-*` response headers and vanishes. The DSH
plugin keeps ring buffers (`recentDecisions`, `recentRequests`) — the daemon has
nothing. Parity:

- [ ] In-memory decision ring buffer in `daemon/server.mjs` (cap ~100).
- [ ] `GET /jev/decisions` → recent decisions `{at, model, tier, effort, backend, latencyMs, confidence}`.
- [ ] `GET /jev/metrics` → counters: decisions by tier/backend, fallback rate (chain→heuristic), brain latency p50/p95, intercepted vs passthrough ratio.
- [ ] Optional JSONL persistence: `JEV_LOG_FILE` appends one line per decision (prompt hash, never prompt text — keeps the "never logged" security stance).

### 1b. Latency & cost: stop paying for the same decision twice *(M)*

- [ ] **Decision cache** keyed on hash(lastUserText) with small TTL (e.g. 100 entries / 10 min). Identical prompts re-hit the brain today; System One warm is 5–10s **in the request path**.
- [ ] **Concurrency guard** in the daemon (the DSH plugin already has `routingInFlight`; the daemon doesn't) — parallel first-turns shouldn't stampede the brain.
- [ ] **Stale-daemon guard in `ensure-daemon.mjs`:** health-check returns version but the launcher never compares it — after an upgrade, an old detached daemon keeps silently serving old routing code. Compare `/health.version` and restart-on-mismatch (pid file or version-embedded port probe).
- [ ] **Bound the routed text in `jev-client.mjs`:** `systemone-client.mjs` truncates state to 6000 chars, but the jev chat brain sends the full last user turn (Claude Code can inject many KBs). Truncate symmetrically.

### 1c. Routing quality: make the policy measurable *(L)*

- [ ] **Golden-set eval harness** (`eval/`): ~30–50 labeled prompts (trivial → frontier, the calibration cases from `tests/core.test.mjs` plus real prompts), expected tier/effort ranges; a `npm run eval` that scores heuristic + brains and prints a confusion matrix. Threshold changes in `core/policy.mjs` stop being vibes.
- [ ] **Reconcile direct picks** (documented future work in ARCHITECTURE.md): System One's `model_tier`/`effort` choice answers are recorded but never compared to the policy outcome. Add an explicit `disagreement` field + metric; decide later whether divergent picks may *lower* (never raise) a tier when confidence is high.
- [ ] **Prompt-size unit tests** for heuristic drift: English keyword lists (`core/heuristic.mjs`) are the only offline brain — add a regression fixture set so keyword edits can't silently re-tier the golden set.

**Exit criteria:** every decision is inspectable (`/jev/decisions`), repeat prompts cost ~0ms, `npm run eval` gives a number before/after any policy change.

---

## Phase 2 — Reach: more surfaces, more upstreams (P2)

### 2a. Upstream generality *(M)* — biggest leverage after Claude

`effortMap` only emits Anthropic `thinking` blocks and `tiers` map to one
provider. To route to *any* provider:

- [ ] **Upstream flavor config** (`upstream.flavor: anthropic | openai-compatible`): effort → `reasoning_effort` (low/medium/high) for OpenAI-style upstreams; keep `thinking` for Anthropic.
- [ ] **Per-provider tier maps** (`tiersByProvider`) so tier→model can cross providers (e.g. fable → a different vendor's frontier model).
- [ ] Daemon: rewrite/strip effort fields per flavor on interception (today only Anthropic-shaped bodies are correct).

### 2b. Adapter gaps *(L, some blocked)*

- [ ] **Claude Desktop `.mcpb` extension** (already on the README roadmap) — config UX + encrypted key storage; local sessions remain blocked (Desktop pins spawn URL) — see `docs/CLAUDE-REAL-BINARY-NOTES.md`.
- [ ] **Codex per-turn routing** — today one decision per launch (`adapters/codex/jev-codex.mjs`); wire-level per-turn rewrite of Codex's Responses API is scoped out of v1. Prototype a mitm-style loopback for Codex's base URL.
- [ ] **Per-turn routing for remote/hosted sessions** (README roadmap item) — needs a gateway-style deployment, not loopback; design doc first.
- [ ] **Unify the DSH plugin with core.** `adapters/dsh/jev-dsh.plugin.mjs` re-implements routing as a hardcoded LLM prompt (no questionnaire, no policy) — two brains that disagree with `core/`. Point it at the daemon (`POST /jev/route`) or import core policy so all surfaces share one decision path. Also fix its global `routingInFlight` gate: concurrent subagent first-turns are skipped entirely today, and `processedTurns` clears at 200 entries losing history.

**Exit criteria:** one upstream config covers Anthropic + OpenAI-compatible; the DSH plugin and the daemon make identical decisions for the same prompt.

---

## Phase 3 — Distribution & polish (P3)

- [ ] **Publish to npm** — `bin` entries exist; add `files`, `prepublishOnly: npm test`, and a postinstall hint. Then `npm i -g lazy-route` replaces clone-and-node in the README.
- [ ] **Daemon as a service** — launchd plist (macOS) / systemd unit (Linux) + docs, so `ensureDaemon`'s detached spawns stop being the only lifecycle.
- [ ] **Lint + format** — zero-dependency repo, so a minimal `node --check`-based lint or eslint flat config; enforce in CI.
- [ ] **Heuristic i18n** — keyword lists are English-only; non-English prompts fall to base priors. At minimum document the limitation; optionally accept a user-supplied keyword file in config.
- [ ] **Landing page sync** — `marketing/lazy-route-landing.html` + `gh-pages` branch: refresh after System One brain, link docs.
- [ ] **Docker image** for the gateway-style deployment prerequisite (2b).

---

## Parked / explicitly out of scope

- Claude Desktop local-session per-turn routing — blocked by Desktop pinning `ANTHROPIC_BASE_URL` at spawn (verified, documented). Revisit only if Desktop changes spawn-env precedence.
- Multi-tenant/auth'd daemon — the sidecar is loopback-only by design; a networked mode would restart the security model (auth, logging of secret-bearing headers).
- Training a custom router model — System One decision models already fill this niche locally.

---

## Quick wins — do these first (all ≤ 1h)

1. LICENSE file (P0, legal correctness).
2. CI workflow (P0, protects every later change).
3. `x-jev-*` headers on 400/500 error responses too (today only successful forwards carry them — tracing a failed interception is blind).
4. `/jev/decisions` ring buffer (observability unlock, ~40 lines).
5. Version check in `ensure-daemon.mjs` health probe.

---

## Appendix — findings from this review (evidence for the items above)

| # | Finding | Where |
|---|---|---|
| 1 | No LICENSE file; `package.json` claims MIT | `package.json` |
| 2 | No CI; tests only run locally | `.github/` missing |
| 3 | Feature branch `feat/systemone-brain` unmerged; stale `claude/*` branches/worktrees remain | `git branch` |
| 4 | Version duplicated in code vs manifest | `daemon/server.mjs:11` vs `package.json:3` |
| 5 | Daemon has no decision log/metrics; DSH plugin has ring buffers (parity gap) | `daemon/server.mjs`, `adapters/dsh/jev-dsh.plugin.mjs:47-49` |
| 6 | No decision cache; System One warm ≈5–10s sits in the request path | `core/systemone-client.mjs`, `daemon/server.mjs:123` |
| 7 | No concurrency guard in daemon (DSH plugin has one, but it's global — concurrent subagent turns are skipped) | `adapters/dsh/jev-dsh.plugin.mjs:50,190` |
| 8 | `ensureDaemon` ignores `/health.version` → stale daemon serves old routing code after upgrade | `adapters/lib/ensure-daemon.mjs:9-16` |
| 9 | jev chat brain forwards unbounded prompt text; systemone truncates to 6000 chars — inconsistent | `core/jev-client.mjs:63` vs `core/systemone-client.mjs:21` |
| 10 | `effortMap` emits only Anthropic `thinking`; no OpenAI-compatible effort mapping | `core/config.mjs:41-47` |
| 11 | DSH plugin doesn't use `core/` (own prompt classifier) — two divergent routing brains | `adapters/dsh/jev-dsh.plugin.mjs:34-44` |
| 12 | System One direct picks recorded but never reconciled with policy (documented future work) | `docs/ARCHITECTURE.md:129` |
| 13 | Error responses (400/500) lack `x-jev-*` observability headers | `daemon/server.mjs:115,134` |
| 14 | Policy thresholds hand-calibrated; no eval harness to regression-score changes | `core/policy.mjs:33` |
| 15 | Heuristic keywords English-only; non-English prompts ride base priors | `core/heuristic.mjs:8-48` |
