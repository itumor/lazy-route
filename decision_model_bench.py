#!/usr/bin/env python3
"""Benchmark tev1 / nimble decision models on Ollama's /v1/systemone endpoint.

Each case has a known expected answer, so we measure accuracy AND latency.
Usage: python3 decision_model_bench.py MODEL[:TAG] ...
"""
import json
import statistics
import sys
import time
import urllib.request

URL = "http://localhost:11434/v1/systemone"


# ---------------------------------------------------------------- test cases
CASES = [
    # --- choice: support-ticket intent routing -------------------------------
    {
        "name": "ticket-duplicate-charge",
        "state": "Customer message: Hi, I checked my statement and your company "
                 "charged my card twice for the October subscription. The amounts "
                 "are both $19.99 on the same day. I have not changed my plan.",
        "questions": {
            "intent": {
                "type": "choice",
                "instructions": "Which listed support intent best matches the customer message?",
                "criteria": {
                    "duplicate_charge": "The customer reports being charged more than once.",
                    "cancel_subscription": "The customer wants to end or downgrade a subscription.",
                    "card_declined": "The customer reports a payment that failed or was declined.",
                    "none": "None of the listed intents matches.",
                },
            },
        },
        "expect": {"intent": "duplicate_charge"},
    },
    {
        "name": "ticket-bug-vs-billing",
        "state": "Our checkout has returned 500 errors since 9am and customers "
                 "cannot complete purchases.",
        "questions": {
            "label": {
                "type": "choice",
                "instructions": "Which label fits this ticket?",
                "criteria": {"billing": None, "bug": None, "account": None, "other": None},
            },
        },
        "expect": {"label": "bug"},
    },
    # --- noul (boolean): policy check ----------------------------------------
    {
        "name": "policy-return-in-window",
        "state": {
            "policy": "Returns are allowed within 30 days of purchase.",
            "request": "I bought these headphones 12 days ago and want to send them back.",
        },
        "questions": {
            "eligible": {"type": "noul", "instructions": "Is this return within the allowed window?"},
        },
        "expect": {"eligible": True},
    },
    {
        "name": "policy-return-late",
        "state": {
            "policy": "Returns are allowed within 30 days of purchase.",
            "request": "I bought these headphones 45 days ago and want to send them back.",
        },
        "questions": {
            "eligible": {"type": "noul", "instructions": "Is this return within the allowed window?"},
        },
        "expect": {"eligible": False},
    },
    # --- noul (boolean): tool-call moderation --------------------------------
    {
        "name": "moderation-destructive",
        "state": 'run_shell(command="rm -rf ~")',
        "questions": {"harm": {"type": "noul", "instructions": "Could this tool call cause harm?"}},
        "expect": {"harm": True},
    },
    {
        "name": "moderation-benign",
        "state": 'run_shell(command="ls -la /var/log")',
        "questions": {"harm": {"type": "noul", "instructions": "Could this tool call cause harm?"}},
        "expect": {"harm": False},
    },
    # --- choice: entailment (MultiNLI style) ---------------------------------
    {
        "name": "entailment-supports",
        "state": "Premise: A man is playing an acoustic guitar on a small stage. "
                 "Hypothesis: A person is making music.",
        "questions": {
            "relation": {
                "type": "choice",
                "instructions": "Does the premise support, contradict, or is it neutral to the hypothesis?",
                "criteria": {
                    "supports": "The premise makes the hypothesis true.",
                    "contradicts": "The premise makes the hypothesis false.",
                    "neutral": "The premise gives no information about the hypothesis.",
                },
            },
        },
        "expect": {"relation": "supports"},
    },
    {
        "name": "entailment-contradicts",
        "state": "Premise: A woman is skiing down a steep snowy mountain. "
                 "Hypothesis: A woman is swimming at the beach.",
        "questions": {
            "relation": {
                "type": "choice",
                "instructions": "Does the premise support, contradict, or is it neutral to the hypothesis?",
                "criteria": {
                    "supports": "The premise makes the hypothesis true.",
                    "contradicts": "The premise makes the hypothesis false.",
                    "neutral": "The premise gives no information about the hypothesis.",
                },
            },
        },
        "expect": {"relation": "contradicts"},
    },
    # --- noul: BoolQ style reading comprehension ------------------------------
    {
        "name": "boolq-photosynthesis",
        "state": "Photosynthesis is the process used by plants, algae and certain "
                 "bacteria to harness energy from sunlight and turn it into chemical "
                 "energy, producing glucose from carbon dioxide and water.",
        "questions": {"answer": {"type": "noul", "instructions": "Do plants use sunlight to make food?"}},
        "expect": {"answer": True},
    },
    # --- choice: news classification (AG News style) --------------------------
    {
        "name": "news-classification",
        "state": "Oil prices surged more than 5 percent Tuesday after the cartel "
                 "announced unexpected production cuts, lifting energy shares across the market.",
        "questions": {
            "category": {
                "type": "choice",
                "instructions": "Which news category does this item belong to?",
                "criteria": {
                    "world": "International politics and events.",
                    "sports": "Athletic competitions and results.",
                    "business": "Markets, companies and the economy.",
                    "sci_tech": "Science and technology.",
                },
            },
        },
        "expect": {"category": "business"},
    },
    # --- choice: model routing -------------------------------------------------
    {
        "name": "model-routing-complex",
        "state": "Design a sharded database schema for a payments ledger with "
                 "strong consistency requirements across regions.",
        "questions": {
            "model": {
                "type": "choice",
                "instructions": "Which model should answer this prompt?",
                "criteria": {"small": "Small model for simple tasks.", "large": "Large model for complex reasoning."},
            },
        },
        "expect": {"model": "large"},
    },
    # --- choice: priority routing from a policy -------------------------------
    {
        "name": "policy-routing-p1",
        "state": {
            "policy": "Route P1 incidents to the on-call engineer. Route billing "
                      "questions to the billing team. Route everything else to support.",
            "ticket": "Severity P1: complete outage of the primary database cluster.",
        },
        "questions": {
            "route": {
                "type": "choice",
                "instructions": "Who should handle this ticket according to the policy?",
                "criteria": {
                    "oncall-engineer": "P1 incidents.",
                    "billing-team": "Billing questions.",
                    "support": "Everything else.",
                },
            },
        },
        "expect": {"route": "oncall-engineer"},
    },
    # --- score: urgency rubric --------------------------------------------------
    {
        "name": "score-urgency-outage",
        "state": "Our production database is down and all customers are seeing "
                 "error pages right now.",
        "questions": {
            "urgency": {
                "type": "score",
                "instructions": "How urgent is this ticket?",
                "criteria": ["Routine", "Soon", "Urgent"],
            },
        },
        "expect": {"urgency": 2},
    },
    # --- score: sentiment rubric (SST style) -----------------------------------
    {
        "name": "score-sentiment-negative",
        "state": "The movie was a complete waste of time and painfully boring "
                 "from start to finish.",
        "questions": {
            "sentiment": {
                "type": "score",
                "instructions": "How positive is this text?",
                "criteria": ["Very Negative", "Negative", "Neutral", "Positive", "Very Positive"],
            },
        },
        "expect": {"sentiment": 1},
    },
    # --- noul: phishing detection ------------------------------------------------
    {
        "name": "phishing-suspicious",
        "state": "URGENT: Your account will be suspended in 24 hours. Click "
                 "http://secure-verify-login.example to confirm your password and "
                 "credit card number immediately.",
        "questions": {"phishing": {"type": "noul", "instructions": "Does this message look like a phishing attempt?"}},
        "expect": {"phishing": True},
    },
]


# ---------------------------------------------------------------- runner
def ask(model, state, questions, keep_alive="15m"):
    body = json.dumps({
        "model": model,
        "state": state,
        "questions": questions,
        "keep_alive": keep_alive,
    }).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def check(case, answers):
    got = {}
    ok = {}
    for qname, expected in case["expect"].items():
        ans = answers.get(qname)
        if ans is None:
            got[qname], ok[qname] = "<missing>", False
            continue
        atype = ans.get("type")
        if atype == "choice":
            got[qname] = ans.get("choice")
        elif atype == "noul":
            got[qname] = bool(ans.get("noul", 0) >= 0.5)
        elif atype == "score":
            got[qname] = round(ans.get("score", 0))
        else:
            got[qname] = f"<unknown type {atype}>"
        ok[qname] = got[qname] == expected
    return got, all(ok.values())


def run_model(model):
    print(f"\n{'=' * 74}\nMODEL: {model}\n{'=' * 74}")

    # Warm-up (includes model load into memory)
    print("Warming up (loading model into memory)...")
    t0 = time.perf_counter()
    ask(model, "Hello, this is a warmup request.", {
        "warmup": {"type": "noul", "instructions": "Is this a greeting?"}})
    print(f"Model load + first answer: {time.perf_counter() - t0:.2f}s\n")

    rows, latencies, total_out_tokens = [], [], 0
    for case in CASES:
        t0 = time.perf_counter()
        try:
            out = ask(model, case["state"], case["questions"])
            lat = time.perf_counter() - t0
        except Exception as exc:  # noqa: BLE001
            rows.append((case["name"], "-", f"ERROR: {exc}", False, float("nan")))
            continue
        usage = out.get("usage", {})
        total_out_tokens += usage.get("output_tokens", 0)
        got, passed = check(case, out.get("answers", {}))
        mark = "PASS" if passed else "FAIL"
        print(f"  [{mark}] {case['name']:<28} {lat * 1000:7.0f} ms   "
              f"expected={json.dumps(case['expect'])} got={json.dumps(got)}")
        rows.append((case["name"], json.dumps(case["expect"]), json.dumps(got), passed, lat))
        latencies.append(lat)

    valid = [r for r in rows if r[1] != "-"]
    n_ok = sum(1 for r in valid if r[3])
    lat_s = [l for l in latencies]
    print(f"\n--- Summary for {model} ---")
    print(f"Accuracy : {n_ok}/{len(valid)} = {100 * n_ok / len(valid):.1f}%")
    if lat_s:
        print(f"Latency  : mean {statistics.mean(lat_s) * 1000:.0f} ms | "
              f"median {statistics.median(lat_s) * 1000:.0f} ms | "
              f"min {min(lat_s) * 1000:.0f} ms | max {max(lat_s) * 1000:.0f} ms")
        print(f"Answering throughput (1 question/call): "
              f"{total_out_tokens / sum(lat_s):.1f} out-tokens/s")
    return {"model": model, "accuracy": 100 * n_ok / len(valid),
            "latency_mean_ms": statistics.mean(lat_s) * 1000 if lat_s else None,
            "latency_median_ms": statistics.median(lat_s) * 1000 if lat_s else None,
            "rows": [(r[0], r[1], r[2], r[3]) for r in rows]}


if __name__ == "__main__":
    models = sys.argv[1:] or ["tev1:4b"]
    results = [run_model(m) for m in models]
    with open("bench_results.json", "w") as fh:
        json.dump(results, fh, indent=2)
    print("\nSaved raw results to bench_results.json")
