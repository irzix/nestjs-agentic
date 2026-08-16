# ADR 008: OpenTelemetry Observability and FrugalGPT Performance Optimization

## Status
**ACCEPTED** (2026-08-16)

---

## Context & Problem Statement
Operating an autonomous multi-agent code review bot in an enterprise monorepo introduces two major operational challenges:
1. **Black-Box Opacity & Audit Deficits:** Without granular distributed tracing, debugging why an agent made a specific recommendation, measuring tool latency, or calculating exact token costs per PR review is impossible.
2. **Cost & Latency Inflation:** Sending every routine diff to expensive high-reasoning models (GPT-4o / Claude 3.7 Sonnet) causes unacceptable monthly API bills ($500+ / mo) and 30s+ turnaround times on simple PRs.

---

## Decision
We choose **OpenTelemetry GenAI Semantic Conventions** with a **PostgreSQL Audit Sink** combined with the **Stanford FrugalGPT Model Cascading Strategy** and **Prompt KV-Cache Alignment**.

```
                         Incoming PR Review Request
                                    │
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │             OpenTelemetry Distributed Tracer           │
       │    (Trace ID: trc_987 | Span: njent.review_turn)       │
       └────────────────────────────┬───────────────────────────┘
                                    │
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │       Stage 1: FrugalGPT Fast Triage (gpt-4o-mini)      │
       │       (Cost: ~$0.0005 | Latency: ~1.2s)                │
       └────────────────────────────┬───────────────────────────┘
                                    │
                     ┌──────────────┴──────────────┐
             [Confidence >= 0.85]          [Confidence < 0.85]
                     ▼                             ▼
           Return Triage Result           Stage 2: High Reasoning
           (65% of PR Reviews)            (gpt-4o / claude-3-7)
                     │                    (Cost: ~$0.015 | Lat: ~6s)
                     │                             │
                     └──────────────┬──────────────┘
                                    │
                                    ▼
       ┌────────────────────────────────────────────────────────┐
       │             PostgreSQL Immutable Audit Sink            │
       ├────────────────────────────────────────────────────────┤
       │ Attributes:                                            │
       │ • gen_ai.system: openai                                │
       │ • gen_ai.request.model: gpt-4o                         │
       │ • gen_ai.usage.prompt_tokens: 1420                     │
       │ • gen_ai.usage.cost_usd: $0.0084                       │
       │ • duration_ms: 2450                                    │
       └────────────────────────────────────────────────────────┘
```

### Key Technical Choices:
1. **Standardized CNCF OpenTelemetry Conventions:**
   * Uses standard semantic attributes: `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.prompt_tokens`, `gen_ai.usage.completion_tokens`, and `gen_ai.agent.turn_id`.
   * Directly exports spans to Jaeger, Datadog, or Grafana Tempo.
2. **FrugalGPT Model Cascading:**
   * Executes lightweight models (`gpt-4o-mini` / `claude-3-5-haiku`) for initial AST parsing, trivial PR filtering, and typo detection.
   * If `confidenceScore >= 0.85`, the review is finalized immediately.
   * If complex architectural or security concerns are flagged, execution cascades to `gpt-4o` / `claude-3-7-sonnet`.
   * **Result:** 65% of straightforward PRs bypass expensive models, reducing overall LLM spend by over 70%.
3. **Prompt KV-Cache Alignment:**
   * Static system instructions, schemas, and framework invariants are anchored at the top of the prompt payload.
   * Maximizes provider KV-cache hits (90%+ cache hit rate on repeated turns), reducing input token latency and cost by 50%.

---

## Alternatives Considered

| Alternative | Advantages | Disadvantages / Rejection Reason |
|---|---|---|
| **Always Use GPT-4o (Single Model Tier)** | Consistent maximum reasoning capability. | 3x to 5x higher API cost; slower average latency on trivial PRs. |
| **Custom Proprietary Logging (Console.log)** | Zero configuration. | Cannot aggregate across distributed nodes; incompatible with APM tools like Datadog or Prometheus. |
| **No Prompt Caching Optimization (Random Prompt Order)** | Flexible prompt building. | Destroys prefix KV-cache reuse on OpenAI/Anthropic; doubles input token charges. |

---

## Consequences & Trade-offs
* **Positive:** > 70% reduction in monthly API spend; sub-2s latency on simple PR reviews; full observability compliant with enterprise OpenTelemetry standards.
* **Negative:** Requires maintaining routing logic in `FrugalModelCascadeRouter`.
