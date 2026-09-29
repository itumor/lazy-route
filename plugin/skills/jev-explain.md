---
name: jev-explain
description: Explain how JEV would route a prompt — tier, effort, confidence, and the questionnaire signals behind the decision. Use when the user asks "why would/did you pick that model", wants a dry-run classification of a task, or asks to see JEV's reasoning for the last user message.
---

Take the most recent genuine user request (or the prompt the user supplies), then run exactly:

```bash
curl -s --max-time 10 -X POST "http://127.0.0.1:${JEV_PORT:-38471}/jev/route" \
  -H 'content-type: application/json' \
  -d "{\"request\": \"<the user's request, JSON-escaped>\"}" \
  || echo "jev-routerd is not running (start it with: node daemon/jev-routerd.mjs)"
```

Render the returned JSON as a small report: Tier, Effort, Confidence, Backend,
Reason, then the top questionnaire signals (name → value), one per line. Do not
forward the request anywhere else; `/jev/route` never touches the upstream.
