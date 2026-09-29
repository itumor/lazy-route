---
name: jev-status
description: Show jev-routerd health and the effective (secret-redacted) routing configuration. Use when the user asks whether JEV routing is active, what tier models are configured, or which strategy/URLs are in effect.
---

Run exactly:

```bash
curl -s --max-time 2 "http://127.0.0.1:${JEV_PORT:-38471}/jev/status" || echo "jev-routerd is not running (start it with: node daemon/jev-routerd.mjs)"
```

Then summarize for the user: strategy, brain URL + model, upstream URL, the
tier→model table, and the alias models that trigger interception. Key material
is already redacted server-side (`***`); do not attempt to reveal it.
