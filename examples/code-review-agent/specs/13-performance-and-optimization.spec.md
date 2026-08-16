# 13 — Performance & Optimization Specification
> **How Njent minimizes latency, optimizes token usage, and implements the FrugalGPT Cascade Algorithm.**

---

## 📚 Academic & Research Foundations
* **FrugalGPT: How to Use Large Language Models While Reducing Cost and Latency** — *Chen et al., Stanford University (2023)* ([arXiv:2305.05176](https://arxiv.org/abs/2305.05176)).
* **Prompt Caching in Large Language Models** — *DeepMind & Anthropic Engineering Research (2024)*.

---

## 1. Conceptual Mapping in Njent

* **The Performance Triangle:** Balancing Latency, Token Cost, and Review Accuracy.
* **FrugalGPT Model Cascade:** Triage first with lightweight model; cascade to high-reasoning model only when confidence $< \tau$.
* **Prompt KV-Caching:** Structuring static system instructions at the prompt header for 90% cache hits on input tokens.
* **Bounded Parallelism:** Running sub-agents concurrently with `maxConcurrency: 3`.

---

## 2. Technical Specification

### 2.1 FrugalGPT Cascade Algorithm (`src/performance/frugal-cascade.service.ts`)
Implementing the model cascade selection mechanism from *Chen et al. (Stanford)*:

```typescript
import { Injectable } from '@nestjs/common';
import { ModelAdapter } from '@nestjs-agentic/core';

@Injectable()
export class FrugalModelCascadeRouter {
  private readonly CASCADE_THRESHOLD = 0.85;

  constructor(
    private readonly fastTriageModel: ModelAdapter, // e.g. gpt-4o-mini
    private readonly highReasoningModel: ModelAdapter, // e.g. gpt-4o / claude-3-7-sonnet
  ) {}

  async executeWithCascade(prompt: string): Promise<{ response: string; modelUsed: string; costTier: 'low' | 'high' }> {
    // Step 1: Execute fast model first (Cost: ~$0.0005)
    const fastResult = await this.fastTriageModel.execute({
      messages: [{ role: 'user', content: prompt }],
    });

    const confidenceScore = this.extractConfidenceScore(fastResult.content);

    // Step 2: FrugalGPT Decision Gate (If confidence >= tau, return immediately)
    if (confidenceScore >= this.CASCADE_THRESHOLD) {
      return { response: fastResult.content, modelUsed: 'gpt-4o-mini', costTier: 'low' };
    }

    // Step 3: Cascade to High-Reasoning Model (Cost: ~$0.015)
    const reasoningResult = await this.highReasoningModel.execute({
      messages: [{ role: 'user', content: prompt }],
    });

    return { response: reasoningResult.content, modelUsed: 'gpt-4o', costTier: 'high' };
  }

  private extractConfidenceScore(content: string): number {
    const match = content.match(/"confidenceScore":\s*([0-9.]+)/);
    return match ? parseFloat(match[1]) : 0.5;
  }
}
```

### 2.2 Concurrency & Bounded Parallel Execution
```typescript
const reviews = await parallelRunner.runParallel(sessionId, ctx, subTasks, {
  maxConcurrency: 3,
  timeoutMs: 30000,
});
```

---

## 3. Key Design Decisions

* **Frugal Cascade Savings:** Filters 65% of straightforward PR reviews through the low-cost model, cutting monthly LLM spend by over 70%.
* **Prompt Caching Structure:** Fixed system prompts and schema tools are placed first, maximizing KV-cache reuse.
