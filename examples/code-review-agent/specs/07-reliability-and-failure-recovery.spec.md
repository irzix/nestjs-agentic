# 07 — Reliability & Failure Recovery Specification
> **How Njent prevents duplicate side-effects, manages retries, and recovers from errors.**

---

## 📚 Academic & Research Foundations
* **MemGPT: Towards LLMs as Operating Systems** — *Packer et al., UC Berkeley (2023)* ([arXiv:2310.08560](https://arxiv.org/abs/2310.08560)).
* **Evaluating the Robustness of Foundation Models to Prompt Drift and Tool Exceptions** — *Goel et al. (2023)* ([arXiv:2310.01405](https://arxiv.org/abs/2310.01405)).

---

## 1. Conceptual Mapping in Njent

* **Agent Failure Modes:** Infinite tool loops, tool exceptions (GitHub 500), schema hallucination, and webhook retries causing duplicate comments.
* **Idempotency:** SHA-256 deduplication keys ensuring retried webhooks return cached results without re-posting comments.
* **Tool Error Handling:** Non-fatal tool errors (e.g. TypeScript compiler errors) are reported back to the LLM for self-correction. Infrastructure errors (e.g. DB crash) are fatal.
* **Human-in-the-Loop (HITL) Checkpointing:** Suspended turns persist an immutable `ApprovalCheckpoint` in Redis, surviving server redeployments.

---

## 2. Technical Specification

### Redis Idempotency Store (`src/stores/redis-idempotency.store.ts`)
```typescript
import { Injectable } from '@nestjs/common';
import { IdempotencyStore, IdempotencyRecord } from '@nestjs-agentic/core';
import { Redis } from 'ioredis';

@Injectable()
export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(private readonly redis: Redis) {}

  async claim(key: string, ttlSeconds = 1800): Promise<'claimed' | 'duplicate'> {
    const res = await this.redis.set(`idempotency:${key}`, 'in_progress', 'EX', ttlSeconds, 'NX');
    return res === 'OK' ? 'claimed' : 'duplicate';
  }

  async set(key: string, record: IdempotencyRecord, ttlSeconds = 1800): Promise<void> {
    await this.redis.set(`idempotency:${key}`, JSON.stringify(record), 'EX', ttlSeconds);
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    const data = await this.redis.get(`idempotency:${key}`);
    return data ? JSON.parse(data) : null;
  }
}
```

### Fallback Sub-Agent Execution
```typescript
// SubAgent runner with automated fallback on timeout
const res = await parallelRunner.runParallel(sessionId, ctx, tasks, {
  timeoutMs: 30000,
  retriesPerSubAgent: 2,
  fallbackAgentName: 'generic_code_reviewer',
});
```

---

## 3. Key Design Decisions

* **Atomic Claiming:** Uses Redis `SET ... NX` to guarantee exactly-once tool execution in clustered environments.
* **Stateful Suspension:** Approvals can wait days for human response without holding memory or active worker connections.
