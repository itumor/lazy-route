#!/usr/bin/env node
// adapters/codex/config-snippet.mjs — print a commented config.toml block for Codex.
// NOTE: codex model_providers with wire_api "responses" are NOT rewritten per turn
// by jev-routerd in v1 — routing for Codex happens at launch time via jev-codex.

const host = process.env.JEV_HOST || '127.0.0.1'
const port = Number(process.env.JEV_PORT || 38471)

console.log(`# jev-router integration for Codex (v1: launch-time routing)
#
# Wire-level per-turn model rewriting for Codex's Responses API is NOT part of
# jev-routerd v1 — the daemon speaks the Anthropic Messages protocol. For Codex,
# use the wrapper, which makes ONE routing decision per launch:
#
#   node adapters/codex/jev-codex.mjs "your task description"
#
# Under the hood it maps the JEV tier onto your configured tier→model table
# (~/.jev/router.json → tiers.{haiku,sonnet,opus,fable}).
#
# If you DO want codex to talk through the daemon as an OpenAI-compatible
# provider (passthrough for non-Anthropic paths; model strings pass untouched),
# the provider shape would be:
#
# [model_providers.jev]
# name = "jev-routerd"
# base_url = "http://${host}:${port}/v1"
# wire_api = "chat"          # passthrough only — no per-turn rewriting
# env_key = "OPENAI_API_KEY" # forwarded by the daemon untouched
#
# model = "gpt-5"            # you pick per launch; JEV does not override it here
# provider = "jev"`)
