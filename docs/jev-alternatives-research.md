# Jev Alternatives Research: Local Model Routing & Model Selection

**Date:** 2026-09-29
**Scope:** Tools that do model routing / model selection / LLM gateway work, with emphasis on local-first deployments. Jev (`jev-router`) is a sidecar that classifies every fresh user turn into a capability tier (`haiku`/`sonnet`/`opus`/`fable`) and effort level (`low`/`medium`/`high`/`xhigh`/`max`), then rewrites the request to the cheapest sufficient model **before** it reaches the provider.

**Method note:** `web_search` was unavailable in this session (missing provider API key), so every claim below was gathered by directly fetching primary sources — project READMEs on GitHub, official docs pages, and pricing pages. Each claim carries a source URL. Nothing is based on secondary blog coverage except where explicitly marked as third-party.

### Jev baseline (grounding for every comparison below)

From this repo's `README.md` and `docs/ARCHITECTURE.md`: each fresh user turn is scored by a 15-signal questionnaire (task complexity, ambiguity, high-stakes, tool complexity, long-horizon, reversibility, …) into a weighted score `S`, mapped deterministically to a tier (`S<0.12→haiku`, `<0.45→sonnet`, `<0.75→opus`, else `fable`, with overrides for high-stakes/novelty/long-horizon) and an effort level that maps to request fields (Anthropic `thinking.budget_tokens` 1k–64k for `low`→`max`). Three strategies: `heuristic` (local, deterministic, offline), `jev` (LLM call to **any** OpenAI-compatible endpoint — including a local Ollama/LM Studio/llama.cpp URL), `chain` (jev with heuristic fallback, default). Zero runtime dependencies (Node ≥ 20); daemon binds 127.0.0.1 only; `authorization`/`x-api-key` forwarded untouched and never logged (test-enforced).

---

## 1. Landscape: where Jev sits

Model routing tooling splits into three layers. Jev is unusual in that it lives at layer 3 (a **pre-execution classifier in the request path**) while remaining thin enough to route *to* layer-1 and layer-2 systems:

| Layer | What it does | Examples |
|---|---|---|
| 1. Inference engines / model servers | Run the model weights, serve an API | llama.cpp, vLLM, TGI, (Ollama & LM Studio wrap these) |
| 2. Gateways / proxies | Unify APIs, load-balance, fallback, auth, spend control between app and providers | LiteLLM Proxy, Portkey, Helicone, Cloudflare AI Gateway |
| 3. Model **selection** / routing decision | Decide *which* model a given prompt should use, before or in-flight | **Jev**, RouteLLM, LiteLLM Auto Router, OpenRouter Auto Router, semantic-router |

**The core architectural distinction:** almost every competitor decides the model *inside the request path at request time*, but they differ in *how* they decide:

- **Trained/learned routers** (RouteLLM, OpenRouter Auto Router): a model or classifier predicts which model will "win" for this prompt.
- **Rule/heuristic classifiers** (Jev heuristic strategy, LiteLLM Auto Router heuristic scorer): deterministic, sub-millisecond, offline.
- **Market-driven selection** (OpenRouter Auto Router): pick whatever the aggregate community currently pays for, per task type.
- **Static config routing** (plain gateways: LiteLLM Router, Portkey, Helicone, Cloudflare): humans pin weights/fallbacks; no per-prompt decision at all.

Jev's questionnaire → (tier, effort) → model rewrite is closest to the second group, with the third group as an emerging cloud equivalent.

---

## 2. Direct alternatives: pre-execution model selection

### 2.1 LiteLLM (SDK + Proxy "AI Gateway" + Auto Router) — the closest all-in-one competitor

- **What it does:** Open-source AI Gateway unifying 100+ LLM providers behind an OpenAI-format API, plus a Python SDK. The Proxy adds virtual keys, spend tracking, guardrails, load balancing, retries/fallbacks, and an admin dashboard. ([README](https://github.com/BerriAI/litellm))
- **Auto Router (beta, v1.94.x):** LiteLLM's own pre-execution tiering engine — "classify each request with heuristics, an LLM classifier, JEV …, lexical/semantic keyword rules, or your own classifier plugin, then route to a pinned model, a random pool, or a Thompson-sampled pool per tier" with tiers `SIMPLE/MEDIUM/COMPLEX/REASONING`. ([Auto Routing docs](https://docs.litellm.ai/docs/proxy/auto_routing))
- **Local vs cloud:** Fully self-hostable (Python SDK, or proxy via `litellm --model`, Docker, Helm, Terraform for AWS/GCP). Provider keys live with you. ([README](https://github.com/BerriAI/litellm))
- **Configuration:** `litellm_config.yaml` (`model_list` with `litellm_params`, `router_settings`, and `complexity_router_config.tiers` for auto routing); provider keys via env (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …). ([Auto Routing docs](https://docs.litellm.ai/docs/proxy/auto_routing), [Routing docs](https://docs.litellm.ai/docs/routing))
- **Cost:** OSS core is free (MIT-ecosystem, per-repo license); Enterprise tier (SSO, custom SLAs, feature prioritization) and a hosted proxy are paid. ([README / Enterprise](https://github.com/BerriAI/litellm))
- **Benchmarks:** "8ms P95 latency at 1k RPS" claimed by the project, with a public benchmarks page. ([README](https://github.com/BerriAI/litellm), [benchmarks](https://docs.litellm.ai/docs/benchmarks))
- **Compared to Jev:**
  - The heuristic scorer is philosophically identical to Jev's heuristic strategy: a zero-API-call, sub-millisecond weighted score over dimensions (tokenCount, codePresence, reasoningMarkers, technicalTerms, simpleIndicators, multiStepPatterns, questionComplexity) mapped to tiers. ([Auto Routing docs](https://docs.litellm.ai/docs/proxy/auto_routing))
  - The default fallback chain (classifier fails → heuristic scorer) mirrors Jev's `chain` strategy (LLM brain with deterministic fallback).
  - **Notable finding:** LiteLLM's Auto Router ships a first-class `classifier_type: jev` option ("JEV through TypeSafe System One Choice", default model `jev-latest`, default base `https://api.typesafe.ai`, `TYPESAFE_API_KEY`, circuit breaker, context window of 3 prior turns). ([Auto Routing docs, JEV classifier section](https://docs.litellm.ai/docs/proxy/auto_routing)) The naming and the questionnaire ("one `questions.tier` Choice question") match Jev's approach; whether this is the same Jev as `jev-router` at `api.jev.dev` or a related product should be verified by the project owner — if so, LiteLLM is not only a competitor but a **distribution channel**: Jev can be the classification brain inside thousands of existing LiteLLM gateways.
  - LiteLLM routes a fixed catalog *you* configure; Jev's tier→model map (`JEV_TIER_HAIKU`…) plus per-CLI adapters (Claude Code, Desktop, Codex, DSH) targets a use case LiteLLM doesn't cover: transparently rewriting the model id inside an existing coding-agent's traffic.

### 2.2 RouteLLM (LMSYS) — the academic direct competitor

- **What it does:** A framework for serving and evaluating **learned LLM routers**. Routes "simpler queries to cheaper models" between a strong/weak model pair using routers trained on preference data (`mf` matrix factorization — recommended, `sw_ranking`, `bert`, `causal_llm`, `random`). Drop-in OpenAI client replacement or an OpenAI-compatible server on `:6060`. ([README](https://github.com/lm-sys/RouteLLM))
- **Local vs cloud:** Self-hosted Python; uses LiteLLM under the hood for provider calls, and explicitly supports **routing to local models via Ollama / any OpenAI-compatible endpoint** (`openai/` prefix + `--base-url`). ([README](https://github.com/lm-sys/RouteLLM), [routing to local models](https://github.com/lm-sys/RouteLLM/blob/main/examples/routing_to_local_models.md))
- **Configuration:** Python `Controller(routers=["mf"], strong_model=…, weak_model=…)` or `python -m routellm.openai_server --routers mf --config config.example.yaml`; clients choose router + threshold via the model string, e.g. `model="router-mf-0.11593"`. Thresholds are calibrated per deployment with `routellm.calibrate_threshold` against Chatbot Arena data. ([README](https://github.com/lm-sys/RouteLLM))
- **Cost:** Free, open source (paper: [arXiv:2406.18665](https://arxiv.org/abs/2406.18665)).
- **Benchmarks (project-published):** Trained routers "reduce costs by up to **85%** while maintaining **95% GPT-4 performance** on MT Bench" and are ">40% cheaper" than commercial routers at equal performance. Ships its own evaluation harness over `mmlu`, `gsm8k`, `mt-bench`. ([README](https://github.com/lm-sys/RouteLLM), [blog](http://lmsys.org/blog/2024-07-01-routellm/))
- **Compared to Jev:** RouteLLM is the strongest *quality-guarantee* story: its routers predict the win-rate of the strong model and only escalate when warranted. But it routes between exactly **two** models (strong/weak pair), needs calibration data resembling your traffic, and the `mf`/`sw_ranking` routers still require an OpenAI key for embeddings. Jev instead offers a 4-tier × 5-effort taxonomy with a deterministic offline fallback and zero calibration — cheaper to operate, weaker in published accuracy evidence.

### 2.3 OpenRouter Auto Router — the cloud equivalent (and the vocabulary overlap)

- **What it does:** Cloud aggregator over hundreds of models with provider-level fallbacks; `openrouter/auto` selects the model per prompt: a fast classifier assigns one of ~30 task types (`code:debugging`, `agent:multi_step_planning`, `math`, …), then ranks models by **aggregate community spend share over a trailing 7-day window**, then applies your `cost_tier` and falls back through the top candidates. ([Auto Router docs](https://openrouter.ai/docs/guides/routing/routers/auto-router))
- **Local vs cloud:** **Cloud only.** All inference happens at OpenRouter's providers; BYOK lets you use your own provider keys with a fee above a monthly allowance. ([FAQ](https://openrouter.ai/docs/faq))
- **Configuration:** Point the OpenAI-compatible base URL at `https://openrouter.ai/api/v1` with a Bearer key; per-request settings via plugins (`cost_tier: low|medium|high|xhigh|max`, `allowed_models`, `excluded_models`), or saved account defaults in the dashboard. ([Auto Router docs](https://openrouter.ai/docs/guides/routing/routers/auto-router))
- **Cost:** Pass-through provider pricing with **no markup**; OpenRouter charges **5.5% ($0.80 minimum) on credit purchases** (5% for crypto). BYOK is free up to a $25,000/month list-price allowance, then **5%**. Free models exist (50 requests/day, 1,000/day with ≥$10 credits). ([FAQ](https://openrouter.ai/docs/faq))
- **Benchmarks:** No routing-accuracy benchmark is published for the Auto Router; the model-selection signal is the public [task-spend rankings](https://openrouter.ai/rankings). Per-model latency/throughput stats are displayed on model pages. ([Auto Router docs](https://openrouter.ai/docs/guides/routing/routers/auto-router), [FAQ](https://openrouter.ai/docs/faq))
- **Compared to Jev:** This is the closest *product* analog in the cloud: prompt classified in-flight, then mapped to a cost band, with session stickiness for multi-turn coherence. Strikingly, OpenRouter's `cost_tier` values — `low/medium/high/xhigh/max` — are exactly Jev's effort-level vocabulary. Differences: OpenRouter's tiers are bands over a market index (no "cheapest sufficient" quality verification per prompt), it cannot route to your local Ollama/LM Studio/llama.cpp endpoints, and your prompts transit a third party. Jev's local-first design (loopback bind, credential forwarding, offline heuristic) is the counter-position.

### 2.4 semantic-router (aurelio-labs) — the encoder-based decision layer

- **What it does:** A Python "superfast decision-making layer": you define `Route` objects with example utterances, and an embedding encoder matches incoming queries into vector space to pick a route (or return `None`). Used for tool-use decisions, guardrails, and model/agent selection without waiting for an LLM. ([README](https://github.com/aurelio-labs/semantic-router))
- **Local vs cloud:** Fully local possible — `HuggingFaceEncoder` + `LlamaCppLLM` via the `[local]` extra; cloud encoders (Cohere, OpenAI) optional. ([README](https://github.com/aurelio-labs/semantic-router), [local execution notebook](https://github.com/aurelio-labs/semantic-router/blob/main/docs/05-local-execution.ipynb))
- **Configuration:** Pure Python library (`pip install semantic-router`); routes + encoder + thresholds in code; vector indexes can live in Pinecone/Qdrant; thresholds trainable. ([README](https://github.com/aurelio-labs/semantic-router))
- **Cost:** Free, MIT-licensed library. ([README](https://github.com/aurelio-labs/semantic-router))
- **Benchmarks:** No official benchmark suite; the project links third-party write-ups of ~10ms decision latency using local encoders/Ollama (third-party, e.g. a community "10ms hotline" test). ([README resources](https://github.com/aurelio-labs/semantic-router))
- **Compared to Jev:** Same "decide before generation" philosophy and similar latency class to Jev's heuristic path, but the taxonomy is *you-authored utterance lists* rather than Jev's fixed capability-tier questionnaire; it returns a route label, not a model rewrite, and it has no provider/credential handling — you build that. Good fit as a component Jev could borrow for fuzzy tier boundaries.

### 2.5 Other commercial routers (noted, not verified this pass)

Martian, NotDiamond, and Unify operate paid model-selection APIs (router-as-a-service). Their docs were not fetched in this pass (search was unavailable), so no claims are made here beyond their existence as a category; treat them as unverified.

---

## 3. Gateways: routing infrastructure without per-prompt classification

These solve the plumbing around model selection (unified API, keys, fallbacks, observability). They are complements to Jev's decision engine, not equivalents.

### 3.1 Portkey (AI Gateway)

- **What it does:** Open-source gateway routing to 250+ LLMs ("1600+ language, vision, audio, image models") with one API; config-driven **fallbacks, retries, load balancing, conditional routing, guardrails, caching**; hosted SaaS + enterprise private deployments. ([README](https://github.com/Portkey-AI/gateway))
- **Local vs cloud:** Self-host via `npx @portkey-ai/gateway` (serves `http://localhost:8787/v1`), Docker, Node, Cloudflare Workers; or Portkey Cloud / enterprise AWS-Azure-GCP-K8s. ([README](https://github.com/Portkey-AI/gateway))
- **Configuration:** JavaScript/TS/Python SDKs or REST; routing behavior declared as JSON `config` objects (e.g. `{"retry": {"attempts": 5}, "output_guardrails": [...]}`) attached per client. ([README](https://github.com/Portkey-AI/gateway))
- **Cost:** Gateway is open source and free; hosted app features (observability, prompt management, provider optimization) and enterprise (SSO, SOC2/HIPAA compliance, PII redaction) are paid — pricing is sales-led. ([README](https://github.com/Portkey-AI/gateway))
- **Benchmarks:** Claims "<1ms gateway latency, 122kb footprint, 10B tokens/day processed". ([README](https://github.com/Portkey-AI/gateway))
- **Compared to Jev:** No prompt classification — routing is operator-authored config. Portkey would be the natural deployment target for Jev-style tiering (or Jev could sit in front of Portkey).

### 3.2 Helicone

- **What it does:** AI Gateway + LLM observability: 100+ models via `ai-gateway.helicone.ai` with "intelligent routing and automatic fallbacks", cost/latency/quality analytics, sessions, prompt management, playground. ([README](https://github.com/Helicone/helicone))
- **Local vs cloud:** SaaS-first; self-host via docker-compose (web, worker, Jawn, Supabase, ClickHouse, MinIO) with an Enterprise Helm chart. ([README](https://github.com/Helicone/helicone))
- **Configuration:** Change the OpenAI client `baseURL` + `HELICONE_API_KEY`; one-line integrations for OpenAI/Anthropic/LangChain/Vercel SDK; Ollama integration supported. ([README](https://github.com/Helicone/helicone))
- **Cost:** Free tier of 10k requests/month; paid plans beyond; self-host is Apache-2.0. ([README](https://github.com/Helicone/helicone), [pricing](https://www.helicone.ai/pricing))
- **Benchmarks:** None published for routing accuracy; observability is async by design.
- **Compared to Jev:** Routing = automatic fallbacks + provider selection, not per-prompt tiering. Strongest as a *measurement* layer to evaluate whether Jev's tier assignments are actually saving money — its cost/latency analytics could quantify Jev's savings per tier.

### 3.3 Langfuse

- **What it does:** Open-source LLM engineering platform: tracing/observability, prompt management, evaluations, datasets, playground. (Routing is *not* a core feature — it appears in this list because it's frequently mislabeled as one.) ([README](https://github.com/langfuse/langfuse))
- **Local vs cloud:** Langfuse Cloud (free tier, EU/US regions) or fully self-hosted (docker compose, Helm, Terraform for AWS/Azure/GCP). MIT-licensed except `ee` folders; part of ClickHouse since January 2026. ([README](https://github.com/langfuse/langfuse))
- **Configuration:** SDK env vars (`LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_BASE_URL`); OpenAI drop-in replacement, LangChain/LlamaIndex callbacks, LiteLLM integration. ([README](https://github.com/langfuse/langfuse))
- **Cost:** Free self-host; cloud free tier + paid usage tiers. ([README](https://github.com/langfuse/langfuse))
- **Benchmarks:** N/A (observability platform).
- **Compared to Jev:** Complementary. Same recommendation as Helicone: wire Jev's routing decisions (`/jev/status`, tier, chosen model) into Langfuse traces to audit classification quality over time.

### 3.4 Cloudflare AI Gateway

- **What it does:** Managed gateway at the edge: analytics, logging, caching, rate limiting, request retry and **model fallback** ("dynamic routing"), guardrails, BYOK; provider-native + OpenAI-compat unified API; integrates with Claude Code/Codex/coding agents. ([overview](https://developers.cloudflare.com/ai-gateway/))
- **Local vs cloud:** Cloud (Cloudflare's network) only; can front providers including OpenRouter, Ollama-compatible custom providers, etc. ([overview](https://developers.cloudflare.com/ai-gateway/), [custom providers](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/))
- **Configuration:** Dashboard-created gateway; requests point at a Cloudflare gateway URL; JSON-configured dynamic routes; REST/Workers bindings. ([overview](https://developers.cloudflare.com/ai-gateway/))
- **Cost:** "Available on all plans" — included from the free Workers plan up; usage billed via Cloudflare. ([overview](https://developers.cloudflare.com/ai-gateway/), [pricing](https://developers.cloudflare.com/ai-gateway/reference/pricing/))
- **Benchmarks:** None published for routing decisions.
- **Compared to Jev:** Sits at the same interception point (in front of the provider) but cloud-only and config-driven; no prompt classification.

---

## 4. Local model servers — where the routed requests land

These don't choose models; they serve them. Jev's "configurable URLs (including **local models**)" design means any of these can be a Jev upstream *or* Jev's classification brain.

### 4.1 Ollama

- **What it does:** The easiest local model server: one-line install, model library (`ollama run gemma4`), REST API on `http://localhost:11434` (`/api/chat`), Python/JS SDKs, Docker image, agent integrations (Claude Code, Codex, Copilot…). Backed by llama.cpp. ([README](https://github.com/ollama/ollama), [API docs](https://docs.ollama.com/api))
- **Local vs cloud:** Fully local and offline. ([README](https://github.com/ollama/ollama))
- **Configuration:** CLI + env (`OLLAMA_HOST` etc.), `Modelfile` for model customization, REST API for serving; OpenAI-compatible `/v1` endpoints. ([README](https://github.com/ollama/ollama), [CLI reference](https://docs.ollama.com/cli))
- **Cost:** Free, MIT-licensed. ([repo](https://github.com/ollama/ollama))
- **Benchmarks:** None official; community benchmarks vary by hardware. (Jev's own config example targets `http://localhost:11434/v1` with `qwen3:8b` as a routing brain.)
- **Compared to Jev:** Complementary. Jev's docs already treat Ollama as a first-class brain (`~/.jev/router.json` → `http://localhost:11434/v1`, model `qwen3:8b`), which makes the whole Jev stack runnable offline.

### 4.2 LM Studio (Element Labs)

- **What it does:** Desktop app for running local LLMs ("Powered by the LM Studio runtime, with **MLX and llama.cpp** under the hood"), now bundled with the **Bionic** agent for work and code; model browser, voice transcription, "LM Link" multi-device, US-hosted Zero-Data-Retention cloud models for heavy tasks. ([homepage](https://lmstudio.ai/))
- **Local vs cloud:** Local-first; optional paid US-hosted OSS model inference (ZDR). ([homepage](https://lmstudio.ai/), [pricing](https://lmstudio.ai/pricing))
- **Configuration:** GUI-first; headless control via the `lms` CLI; OpenAI-compatible local server for apps; SDKs (`lmstudio-js`, `lmstudio-python`). ([developer docs](https://lmstudio.ai/docs/developer), [CLI docs](https://lmstudio.ai/docs/cli))
- **Cost:** **Free** tier covers running local LLMs, the Bionic agent, voice, LM Link (5 devices); **Bionic+ $20/mo** (US-hosted OSS models: Kimi K3, GLM 5.3, DeepSeek V4 Flash…); **Pro $100/mo** (5× usage, early features). ([pricing](https://lmstudio.ai/pricing))
- **Benchmarks:** None published.
- **Compared to Jev:** GUI/server alternative to Ollama for hosting Jev's local brains and upstreams; its OpenAI-compatible server means zero adapter work. No routing intelligence of its own.

### 4.3 llama.cpp / llama-server

- **What it does:** Plain C/C++ LLM+VLM inference "with minimal setup and state-of-the-art performance on a wide range of hardware"; `llama-server` ships an **OpenAI-compatible REST API** plus built-in web UI; quantization from 1.5-bit to 8-bit; CPU+GPU hybrid inference. ([README](https://github.com/ggml-org/llama.cpp))
- **Local vs cloud:** Fully local (or in your own cloud containers). ([README](https://github.com/ggml-org/llama.cpp))
- **Configuration:** CLI flags and the `tools/server` component (`llama serve -hf <model>`); no config-file ceremony; extensive backend matrix (Metal, CUDA, HIP, Vulkan, SYCL, OpenVINO, …). ([README](https://github.com/ggml-org/llama.cpp), [server docs](https://github.com/ggml-org/llama.cpp/tree/master/tools/server))
- **Cost:** Free, MIT. ([README](https://github.com/ggml-org/llama.cpp))
- **Benchmarks:** No official cross-tool benchmark; the repo publishes performance troubleshooting guides; `llama-bench` ships in-tree. ([performance docs](https://github.com/ggml-org/llama.cpp/blob/master/docs/development/token_generation_performance_tips.md))
- **Compared to Jev:** The performance floor and the substrate Ollama builds on; also the highest-control option if Jev wants a tiny local brain with no runtime dependency.

### 4.4 vLLM

- **What it does:** High-throughput serving library: **PagedAttention** KV-cache management, continuous batching, chunked prefill, prefix caching, spec decoding, quantization (FP8/INT8/GPTQ/AWQ/GGUF/…), OpenAI-compatible server **plus Anthropic Messages API and gRPC**, 200+ model architectures, multi-node parallelism. ([README](https://github.com/vllm-project/vllm))
- **Local vs cloud:** Self-hosted on your GPUs (NVIDIA/AMD/Intel/Apple Silicon/TPU/Gaudi/Ascend); not a desktop end-user tool. ([README](https://github.com/vllm-project/vllm))
- **Configuration:** `uv pip install vllm` then `vllm serve` (CLI args/env); OpenAI-compatible server on `:8000`. ([docs](https://docs.vllm.ai/en/latest/))
- **Cost:** Free, Apache-2.0. ([repo](https://github.com/vllm-project/vllm))
- **Benchmarks:** Peer-reviewed: vLLM/PagedAttention "improves the throughput of popular LLMs by **2–4×** with the same latency vs state-of-the-art systems (FasterTransformer, Orca)", more at longer sequences/larger models. ([arXiv:2309.06180](https://arxiv.org/abs/2309.06180), SOSP 2023)
- **Compared to Jev:** The server you route *to* when a tier maps to self-hosted GPUs; Anthropic-Messages compatibility means a Claude-Code-style client can be pointed at it, the same interception surface Jev uses.

### 4.5 TGI (Text Generation Inference, Hugging Face) — now in maintenance mode

- **What it does:** Rust+gRPC serving toolkit powering HF's own Inference API: continuous batching, tensor parallelism, SSE streaming, OpenAI-compatible Messages API, quantization (bitsandbytes/GPTQ/AWQ/Marlin/fp8), spec decoding ("~2x latency"), OTel/Prometheus. ([README](https://github.com/huggingface/text-generation-inference))
- **⚠️ Status:** The project is officially **in maintenance mode**; HF recommends downstream engines **vLLM or SGLang** (and llama.cpp/MLX locally) going forward. ([README caution block](https://github.com/huggingface/text-generation-inference))
- **Local vs cloud:** Self-hosted (Docker `ghcr.io/huggingface/text-generation-inference`, or source/Nix); NVIDIA/AMD/Inferentia/Intel/Gaudi/TPU. ([README](https://github.com/huggingface/text-generation-inference))
- **Configuration:** `text-generation-launcher --model-id …` flags; Docker env (`HF_TOKEN`); OpenAI-compatible `/v1/chat/completions`. ([README](https://github.com/huggingface/text-generation-inference))
- **Cost:** Free; license is custom (HFOIL heritage — check the repo LICENSE; restricts offering TGI itself as a managed service). ([repo](https://github.com/huggingface/text-generation-inference))
- **Benchmarks:** Project-published claim: speculative decoding gives ~2× latency improvement. ([README](https://github.com/huggingface/text-generation-inference))
- **Compared to Jev:** Historically the TGI choice would have been a strong local upstream; in 2026 the maintenance-mode notice means **vLLM (or SGLang) is the rational default** for GPU-class upstreams in a Jev tier map.

---

## 5. Local vs Cloud matrix

| Tool | Runs fully local? | Can serve local models? | Can route *to* local models? | Routes per-prompt? |
|---|---|---|---|---|
| **Jev** | ✅ (loopback daemon; heuristic strategy = 100% offline) | n/a (routes to any URL) | ✅ core design (`JEV_UPSTREAM_URL`, Ollama example) | ✅ (questionnaire → tier+effort) |
| LiteLLM Proxy | ✅ self-host | ✅ (Ollama, vLLM, LM Studio providers) | ✅ | ✅ Auto Router (beta); else static |
| RouteLLM | ✅ self-host | ✅ (via OpenAI-compatible endpoints) | ✅ (Ollama guide) | ✅ (trained router) |
| OpenRouter | ❌ cloud | ❌ | ❌ | ✅ (auto router, market-driven) |
| Portkey | ✅ self-host gateway | ✅ (Ollama provider) | ✅ | ❌ (config-driven) |
| Helicone | ✅ self-host (heavy stack) | ✅ (Ollama logging) | ✅ | ❌ (fallbacks only) |
| Langfuse | ✅ self-host | observability only | n/a | ❌ |
| Cloudflare AI Gateway | ❌ edge cloud | via custom providers | partial | ❌ (fallbacks/dynamic routes) |
| Ollama | ✅ | ✅ | n/a | ❌ |
| LM Studio | ✅ | ✅ | n/a | ❌ (manual) |
| llama.cpp | ✅ | ✅ | n/a | ❌ |
| vLLM | ✅ (GPU host) | ✅ | n/a | ❌ |
| TGI | ✅ | ✅ | n/a | ❌ (maintenance mode) |

---

## 6. Cost comparison

| Tool | Upfront | Ongoing | Model costs |
|---|---|---|---|
| **Jev** | Free (OSS sidecar) | $0 (heuristic strategy); one small classification LLM call per turn otherwise (can be a free local model) | Whatever the tier map points at |
| LiteLLM OSS | Free | $0 self-host | Provider pass-through |
| LiteLLM Enterprise/Hosted | — | Paid (sales-led) | Provider pass-through |
| RouteLLM | Free (OSS) | $0 self-host; embeddings for `mf`/`sw_ranking` need an OpenAI key | Strong/weak pair you choose |
| OpenRouter | Free to sign up | **5.5% fee on credit purchases** ($0.80 min; 5% crypto); BYOK 5% above $25k/mo allowance | Provider pass-through, no markup |
| Portkey gateway | Free (OSS) | $0 self-host; SaaS/enterprise paid | Provider pass-through |
| Helicone | Free ≤10k req/mo | Paid tiers above | Provider pass-through |
| Langfuse | Free self-host (MIT) | Cloud free tier; paid above | n/a |
| Cloudflare AI Gateway | Included in all plans | Cloudflare usage | Provider pass-through |
| Ollama / llama.cpp | Free (MIT) | $0 + your hardware | $0 (open weights) |
| LM Studio | Free tier | $0 local; Bionic+ $20/mo; Pro $100/mo | $0 local; included cloud quota |
| vLLM | Free (Apache-2.0) | $0 + GPU hardware | $0 (open weights) |
| TGI | Free (custom license) | $0 + GPU hardware | $0 (open weights) |

---

## 7. Benchmarks & performance claims (with provenance)

| Tool | Claim | Type | Source |
|---|---|---|---|
| LiteLLM | 8ms P95 at 1k RPS | First-party | [README](https://github.com/BerriAI/litellm), [benchmarks page](https://docs.litellm.ai/docs/benchmarks) |
| RouteLLM | up to 85% cost reduction at 95% GPT-4 quality (MT Bench); >40% cheaper than commercial routers | First-party + paper | [README](https://github.com/lm-sys/RouteLLM), [arXiv:2406.18665](https://arxiv.org/abs/2406.18665) |
| vLLM | 2–4× throughput vs FasterTransformer/Orca at equal latency (PagedAttention, SOSP 2023) | Peer-reviewed | [arXiv:2309.06180](https://arxiv.org/abs/2309.06180) |
| TGI | ~2× latency with speculative decoding; ⚠️ maintenance mode | First-party | [README](https://github.com/huggingface/text-generation-inference) |
| Portkey | <1ms gateway latency; 10B tokens/day | First-party | [README](https://github.com/Portkey-AI/gateway) |
| OpenRouter Auto Router | No accuracy benchmark; selection signal = 7-day aggregate community spend per task type | First-party (methodology) | [Auto Router docs](https://openrouter.ai/docs/guides/routing/routers/auto-router) |
| semantic-router | Millisecond decisions (community ~10ms tests with local encoders) | Third-party | [README resources](https://github.com/aurelio-labs/semantic-router) |
| Ollama / llama.cpp / LM Studio | No official cross-tool benchmarks; hardware-dependent | — | [llama.cpp perf notes](https://github.com/ggml-org/llama.cpp/blob/master/docs/development/token_generation_performance_tips.md) |

**Benchmark gap Jev could fill:** none of the routing tools publish a *classification-accuracy-per-dollar* benchmark on coding-agent traffic. RouteLLM is closest (win-rate prediction vs GPT-4 on MT Bench/MMLU/GSM8K). LiteLLM's Auto Router docs describe savings accounting that deducts classifier cost from reported savings (`classifier_cost`), and reference a benchmark at `/blog/jev-auto-router-benchmark` — worth reading before designing Jev's own eval harness. ([Auto Routing docs](https://docs.litellm.ai/docs/proxy/auto_routing))

---

## 8. Positioning summary: Jev vs the field

**What only Jev does:**
1. **Interception in the agent's request path** — Claude Code/Codex alias rewriting and loopback proxying, so the *client* still believes it's talking to `claude-opus-*` while the wire carries `haiku-*`. Gateways require repointing the client's base URL; agent-native pickers (Claude Code "JEV Router" model entry) exist nowhere else.
2. **Tier + effort as a 2-D decision** (haiku…fable × low…max). The nearest analogs are 1-D: RouteLLM's strong/weak pair, LiteLLM's SIMPLE…REASONING, OpenRouter's cost_tier bands.
3. **Guaranteed-offline path**: `JEV_STRATEGY=heuristic` runs the whole router with zero network calls; every interception falls back deterministically.
4. **Credential pass-through, never stored** — verified by tests (`tests/daemon.test.mjs`); contrast with gateways that virtualize keys by design.

**What competitors do better today:**
1. **Published routing accuracy** (RouteLLM: 95% GPT-4 parity at up to 85% savings) vs Jev's unverified questionnaire.
2. **Breadth of governance**: keys/budgets/guardrails/audit (LiteLLM, Portkey, Cloudflare) that a personal sidecar deliberately lacks.
3. **Market-adaptive selection**: OpenRouter's spend-share ranking updates within days without retraining; Jev's tier map is static config.
4. **Ecosystem gravity**: LiteLLM's Auto Router is a plug-in classifier architecture with a `jev` classifier type already documented — an integration surface Jev could target (verify identity of the "TypeSafe JEV" first).

**Practical recommendation set (for the repo's docs):**
- Keep Jev for **agent-path interception and local-first routing** — no alternative covers it.
- If centralized spend control is needed later, put **LiteLLM Proxy** behind or in front of Jev rather than replacing it.
- Use **Helicone or Langfuse** to measure Jev's actual savings per tier/effort before trusting the heuristic's tier boundaries.
- For GPU-tier local upstreams, prefer **vLLM** (TGI is in maintenance mode); for laptop-tier, **Ollama** (or LM Studio if a GUI is wanted).
- **Steal-worthy mechanics:** RouteLLM's threshold calibration against your own prompt distribution (`routellm.calibrate_threshold --strong-model-pct`) maps 1:1 onto Jev's tier cutoffs (0.12/0.45/0.75) — same idea, empirically grounded; semantic-router's utterance-list route definitions would give Jev a second, embedding-based offline backend for fuzzy tier boundaries.

---

## 9. Sources

Primary sources fetched directly (2026-09-29):

- LiteLLM — [GitHub README](https://github.com/BerriAI/litellm) · [Auto Routing (beta)](https://docs.litellm.ai/docs/proxy/auto_routing) · [Benchmarks](https://docs.litellm.ai/docs/benchmarks) · [Router docs](https://docs.litellm.ai/docs/routing)
- RouteLLM — [GitHub README](https://github.com/lm-sys/RouteLLM) · [Paper](https://arxiv.org/abs/2406.18665) · [Blog](http://lmsys.org/blog/2024-07-01-routellm/)
- OpenRouter — [FAQ](https://openrouter.ai/docs/faq) · [Auto Router](https://openrouter.ai/docs/guides/routing/routers/auto-router) · [Rankings](https://openrouter.ai/rankings)
- Portkey — [Gateway README](https://github.com/Portkey-AI/gateway) · [Docs](https://portkey.ai/docs)
- Helicone — [GitHub README](https://github.com/Helicone/helicone) · [Pricing](https://www.helicone.ai/pricing)
- Langfuse — [GitHub README](https://github.com/langfuse/langfuse) · [Self-hosting](https://langfuse.com/self-hosting)
- Cloudflare AI Gateway — [Docs overview](https://developers.cloudflare.com/ai-gateway/) · [Pricing](https://developers.cloudflare.com/ai-gateway/reference/pricing/)
- Ollama — [GitHub README](https://github.com/ollama/ollama) · [API docs](https://docs.ollama.com/api)
- LM Studio — [Homepage](https://lmstudio.ai/) · [Pricing](https://lmstudio.ai/pricing) · [Developer docs](https://lmstudio.ai/docs/developer)
- llama.cpp — [GitHub README](https://github.com/ggml-org/llama.cpp) · [Server docs](https://github.com/ggml-org/llama.cpp/tree/master/tools/server)
- vLLM — [GitHub README](https://github.com/vllm-project/vllm) · [PagedAttention paper (SOSP 2023)](https://arxiv.org/abs/2309.06180) · [Docs](https://docs.vllm.ai)
- TGI — [GitHub README (maintenance-mode notice)](https://github.com/huggingface/text-generation-inference)
- semantic-router — [GitHub README](https://github.com/aurelio-labs/semantic-router)
- Jev (internal) — `README.md`, `docs/ARCHITECTURE.md` in this repo
