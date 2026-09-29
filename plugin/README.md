# JEV Router — Claude Plugin (UX layer only)

This plugin gives Claude Code/Desktop sessions **skills around JEV**: `/jev-status`,
`/jev-explain`, `/jev-models`, plus a SessionStart health ping.

## It deliberately does NOT intercept traffic

Model routing must happen **before** Claude picks a model for the turn:

```
prompt → JEV decides tier+effort → Claude runs on that model
```

MCP tools and plugin hooks run **after** a model is already selected, so they
can never choose it (chicken-and-egg). Interception therefore lives in the
request path:

- Claude CLI/Desktop: the loopback proxy `daemon/jev-routerd.mjs` + the
  `ANTHROPIC_BASE_URL` / custom-model-option env contract
  (`adapters/claude-cli`, `adapters/claude-desktop`).
- DeepSeek Harness: the `agent/request` waterfall (`adapters/dsh`).

What this plugin provides is the friendly surface: dry-run classification,
config introspection, and a health heartbeat.

## Install

```bash
claude plugin install ./plugin          # CLI
# or Claude Desktop → Settings → Plugins → add this directory (local sessions)
```

Then start the sidecar (`node daemon/jev-routerd.mjs`, or the launchd unit) and
select the **JEV Router** model option in the Code tab.
