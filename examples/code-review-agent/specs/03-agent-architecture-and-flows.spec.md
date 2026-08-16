# 03 — Agent Architecture & Flows
> **How Njent orchestrates workflows, specialist sub-agents, and delegation.**

---

## 📚 Academic & Research Foundations
* **MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework** — *Hong et al. (ICLR 2024)* ([arXiv:2308.00352](https://arxiv.org/abs/2308.00352)).
* **AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation** — *Wu et al., Microsoft Research (2023)* ([arXiv:2308.08155](https://arxiv.org/abs/2308.08155)).

---

## 1. Conceptual Mapping in Njent

* **Agent Flow vs. Orchestration:**
  * **Flow (Deterministic):** Outer pipeline managing Webhook Ingress ➔ RAG ➔ Review ➔ Quality Gate ➔ Egress.
  * **Orchestration (Dynamic):** Supervisor LLM coordinating parallel specialist workers and synthesizing outputs.
* **Nodes & Edges:** Represented as NestJS pipeline stages and asynchronous sub-agent runners.
* **Sub-Agents:** Isolated agents with narrow domains (Security, Architecture, Performance, Fixer).
* **Agent Delegation:** Delegating sub-tasks from supervisor to workers with scoped security contexts via `SubAgentDelegator`.

---

## 2. Technical Specification

### Supervisor Orchestration Pipeline (`src/webhooks/pr-review.orchestrator.ts`)
```typescript
import { Injectable } from '@nestjs/common';
import { AgentContext } from '@nestjs-agentic/core';
import { ParallelSubAgentRunner, RefinementLoopRunner, SubAgentTask } from '@nestjs-agentic/orchestration';

@Injectable()
export class PrReviewOrchestrator {
  constructor(
    private readonly parallelRunner: ParallelSubAgentRunner,
    private readonly refinementRunner: RefinementLoopRunner,
  ) {}

  async runReview(sessionId: string, ctx: AgentContext, prDiff: string) {
    // 1. Parallel Specialist Sub-Agent Fan-Out
    const subTasks: SubAgentTask[] = [
      { agentName: 'security_reviewer', message: `Audit for security vulnerabilities:\n${prDiff}` },
      { agentName: 'architecture_reviewer', message: `Audit for nestjs-agentic architectural compliance:\n${prDiff}` },
      { agentName: 'quality_reviewer', message: `Audit code performance and TypeScript typing:\n${prDiff}` },
    ];

    const aggregated = await this.parallelRunner.runParallel(sessionId, ctx, subTasks, {
      aggregationStrategy: 'allSettled',
      timeoutMs: 30000,
      maxConcurrency: 3,
    });

    // 2. Supervisory Refinement & Quality Loop
    return this.refinementRunner.runRefinementLoop(
      `${sessionId}_refine`,
      ctx,
      'lead_synthesizer',
      `Synthesize these reviews into a clear PR comment:\n${aggregated.output}`,
      { maxIterations: 2, qualityThreshold: 0.85 }
    );
  }
}
```

---

## 3. Key Design Decisions

* **Hierarchical Supervisor-Worker:** Eliminates monolithic prompt clutter and ensures each sub-agent operates within a clean, focused context.
* **Bounded Concurrency (`maxConcurrency: 3`):** Protects the host server and LLM rate limits from unbounded thread starvation.
