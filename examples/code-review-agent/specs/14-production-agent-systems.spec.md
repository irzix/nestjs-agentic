# 14 — Production Agent Systems Specification
> **How Njent ensures production readiness, horizontal scalability, and continuous improvement.**

---

## 📚 Academic & Research Foundations
* **The Rise and Potential of Large Language Model Based Agents: A Survey** — *Xi et al., Fudan University & ByteDance (2023)* ([arXiv:2309.07864](https://arxiv.org/abs/2309.07864)).
* **Self-Refine: Iterative Refinement with Self-Feedback** — *Madaan et al., Carnegie Mellon University (NeurIPS 2023)* ([arXiv:2303.17651](https://arxiv.org/abs/2303.17651)).

---

## 1. Conceptual Mapping in Njent

* **The 5 Production Pillars:** Durability, Idempotency, Governance, Observability, and Scalability.
* **Modular Monolith + Queue Decoupling:** Fast HTTP Webhook ingress acknowledging GitHub in < 200ms, pushing PR review jobs to BullMQ workers for execution.
* **Continuous Improvement:** Incorporating maintainer corrections into the episodic store to improve prompt accuracy automatically.

---

## 2. Technical Specification

### Production NestJS Configuration (`src/app.module.ts`)
```typescript
import { Module } from '@nestjs/common';
import { AgenticModule, RedisSessionStore, RedisApprovalStore, RedisIdempotencyStore } from '@nestjs-agentic/core';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel: { provider: 'openai', model: process.env.MODEL_NAME || 'gpt-4o' },
      sessionStore: new RedisSessionStore({ redis }),
      idempotencyStore: new RedisIdempotencyStore(redis),
      approvalTtlSeconds: 86400,
      limits: { maxTurns: 8, maxToolCalls: 12, maxDurationMs: 60000 },
      toolErrorHandling: 'report',
    }),
  ],
})
export class AppModule {}
```

---

## 3. Production Readiness Checklist

| Category | Guarantee | Implementation |
|---|---|---|
| **Security** | RBAC verification & Secret redaction. | `CollaboratorGuard` + `PromptInjectionSanitizer`. |
| **Governance** | Human approval for commits. | `RequireMaintainerApprovalPolicy`. |
| **Reliability** | Zero duplicate posts on retries. | `RedisIdempotencyStore` (`NX` locking). |
| **Durability** | Zero state loss on pod crashes. | `ApprovalCheckpoint` in Redis. |
| **Scalability** | Horizontal worker scaling. | Stateless NestJS Pods + BullMQ Queue. |
