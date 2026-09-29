---
name: jev-models
description: List the tier-to-model mapping JEV will route to (haiku/sonnet/opus/fable plus efforts), and which model aliases ("jev-router") trigger interception. Use when the user asks what models are available or what a tier maps to.
---

Run exactly:

```bash
curl -s --max-time 2 "http://127.0.0.1:${JEV_PORT:-38471}/jev/status" | grep -A6 '"tiers"' || echo "jev-routerd is not running (start it with: node daemon/jev-routerd.mjs)"
```

Present the tier table (tier → concrete upstream model), the five effort levels
(low/medium/high/xhigh/max → thinking budgets), and the alias model
(`jev-router`) the user selects in the model picker to enable routing.
