# 10 — Observability & Monitoring Specification
> **How Njent traces multi-turn trajectories, logs audit events, and monitors costs.**

---

## 📚 Academic & Research Foundations
* **Semantic Conventions for Generative AI Operations** — *OpenTelemetry CNCF Working Group (2024)* ([opentelemetry.io/docs/specs/semconv/gen-ai/](https://opentelemetry.io/docs/specs/semconv/gen-ai/)).
* **Towards Observability and Evaluation of Large Language Model Systems** — *Madaan et al. (2024)*.

---

## 1. Conceptual Mapping in Njent

* **Agent Observability:** Tracking multi-turn trajectories, tool invocation latencies, and token consumption.
* **Semantic Tracing:** Capturing model prompts, tool arguments, reasoning outputs, and policy decisions per trace ID.
* **Auditability:** Emitting immutable compliance events to `AuditSink`.
* **Cost Monitoring:** Calculating cumulative token spend in USD per PR review.

---

## 2. Technical Specification

### PostgreSQL Audit Sink (`src/audit/postgres-audit.sink.ts`)
```typescript
import { Injectable } from '@nestjs/common';
import { AuditSink, AuditEvent } from '@nestjs-agentic/core';

@Injectable()
export class PostgresAuditSink implements AuditSink {
  async record(event: AuditEvent): Promise<void> {
    // Stores event with full trace ID, actor, tool name, tokens, and duration
    await db.query(
      `INSERT INTO audit_events (trace_id, session_id, event_type, actor, tool_name, decision, prompt_tokens, completion_tokens, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [event.traceId, event.sessionId, event.type, event.actor, event.toolName, event.decision, event.usage?.promptTokens, event.usage?.completionTokens, event.durationMs]
    );
  }
}
```

### Core Metrics Exported (Prometheus / OTel)
* `njent_reviews_total{status="success|failed|suspended"}`
* `njent_tokens_total{type="prompt|completion"}`
* `njent_cost_dollars_total`
* `njent_review_duration_seconds`

---

## 3. Key Design Decisions

* **Pre-Audit Secret Scrubbing:** Guarantees that sensitive tokens and API keys are scrubbed before reaching audit logs.
* **Structured JSON Logging:** Fully compatible with Datadog, Grafana Loki, and CloudWatch.
