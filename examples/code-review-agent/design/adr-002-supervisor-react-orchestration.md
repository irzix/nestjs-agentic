# ADR 002: Hierarchical Supervisor-Worker Orchestration with MetaGPT SOPs and ReAct Reasoning

## Status
**ACCEPTED** (2026-08-16)

---

## Context & Problem Statement
Conducting a comprehensive code review requires simultaneously evaluating security vulnerabilities, architectural compliance, type-safety, and algorithmic performance.

Attempting to perform all these evaluations in a single monolithic prompt creates several critical failure modes:
1. **Context Clutter & Confusion:** Security instructions interfere with architectural conventions, leading to unfocused and shallow reviews.
2. **Sequential Latency Bottlenecks:** Evaluating large diffs sequentially across multiple perspectives results in unacceptable 45–60s webhook timeouts.
3. **Chaotic Multi-Agent Chat:** Unstructured peer-to-peer debates between autonomous agents can loop indefinitely, consuming unpredictable API tokens without reaching actionable consensus.

---

## Decision
We choose a **Hierarchical Supervisor-Worker Orchestration Topology** governed by **MetaGPT Standard Operating Procedures (SOPs)** and **ReAct Trajectory Reasoning**.

```
                           ┌───────────────────────────┐
                           │   GitHub Webhook Event    │
                           └─────────────┬─────────────┘
                                         │
                                         ▼
                           ┌───────────────────────────┐
                           │    PrReviewOrchestrator   │
                           └─────────────┬─────────────┘
                                         │
                 ┌───────────────────────┼───────────────────────┐
                 │ (Parallel Fan-Out)    │ maxConcurrency: 3     │
                 ▼                       ▼                       ▼
      ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
      │  Security Reviewer  │ │Architecture Reviewer│ │   Quality Reviewer  │
      │  (@Agent Worker)    │ │  (@Agent Worker)    │ │  (@Agent Worker)    │
      └──────────┬──────────┘ └──────────┬──────────┘ └──────────┬──────────┘
                 │                       │                       │
                 └───────────────────────┼───────────────────────┘
                                         ▼
                           ┌───────────────────────────┐
                           │ MultiAgentConsensusChecker│
                           │ (Variance & Debate Score) │
                           └─────────────┬─────────────┘
                                         │
                                         ▼
                           ┌───────────────────────────┐
                           │   Lead Synthesizer Agent  │
                           │   (ReAct Supervisor Loop) │
                           └─────────────┬─────────────┘
                                         │
                                         ▼
                           ┌───────────────────────────┐
                           │  RefinementLoopRunner     │
                           │  (Quality Gate Threshold) │
                           └───────────────────────────┘
```

### Key Technical Choices:
1. **Isolated Specialist Workers:**
   * `SecurityReviewerAgent`: Receives only security policies, auth rules, and diff context.
   * `ArchitectureReviewerAgent`: Receives repository design patterns and roadmap ASTs.
   * `QualityReviewerAgent`: Focuses exclusively on algorithmic complexity, async promises, and TypeScript strictness.
2. **Parallel Sub-Agent Fan-Out:** Executed via `ParallelSubAgentRunner` with `maxConcurrency: 3` and `timeoutMs: 30000`, reducing review latency by ~65%.
3. **Consensus Convergence Metric:** Evaluates inter-agent agreement variance:
   $$\text{Consensus} = 1 - \frac{\text{Variance}}{\text{MaxVariance}}$$
4. **Supervisory ReAct Refinement:** The `LeadSynthesizerAgent` executes a ReAct reasoning cycle (`Thought ➔ Action ➔ Observation ➔ FinalAnswer`) to consolidate worker findings into a single unified Markdown report.
5. **U-Shaped Context Ordering:** Prompts are structured with high-attention primacy on system instructions, reference ASTs in the middle, and target PR diffs in the recency region.

---

## Alternatives Considered

| Alternative | Advantages | Disadvantages / Rejection Reason |
|---|---|---|
| **Monolithic Single-Prompt Reviewer** | Simpler codebase; single LLM call. | Massive token consumption; severe prompt degradation; cannot isolate security domains. |
| **Unstructured Autonomous Chat (AutoGen style)** | High conversational dynamism. | High risk of infinite loops; non-deterministic latency; excessive token cost; lacks SOP predictability. |
| **Sequential Pipeline Reviewers** | Easy to trace. | High latency (3x longer response time); fails GitHub webhook deadline requirements. |

---

## Consequences & Trade-offs
* **Positive:** Modular and testable sub-agents; ~65% latency reduction via parallel fan-out; predictable token spend through MetaGPT SOP phases.
* **Negative:** Requires running multiple sub-agent completions; requires supervisor synthesis stage.
