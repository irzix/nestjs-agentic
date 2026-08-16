# 08 — Multi-Agent Orchestration Specification
> **How Njent coordinates specialized domain sub-agents via MetaGPT SOPs and Multi-Agent Debate Consensus.**

---

## 📚 Academic & Research Foundations
* **MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework** — *Hong et al., DeepWisdom (ICLR 2024)* ([arXiv:2308.00352](https://arxiv.org/abs/2308.00352)).
* **Improving Factuality and Reasoning in Language Models through Multiagent Debate** — *Du et al., MIT (2023)* ([arXiv:2305.14325](https://arxiv.org/abs/2305.14325)).
* **More Agents Is All You Need** — *Li et al., Tencent AI Lab (2024)* ([arXiv:2402.05120](https://arxiv.org/abs/2402.05120)).

---

## 1. Conceptual Mapping in Njent

* **Standard Operating Procedures (MetaGPT SOPs):** Structuring agent communication through rigid schemas and state transitions rather than unstructured chat.
* **Supervisor-Worker Pattern:** `LeadSynthesizer` supervisor coordinates `SecurityReviewer`, `ArchitectureReviewer`, and `QualityReviewer`.
* **Multi-Agent Debate & Consensus Convergence:** Sub-agents debate conflicting findings to reach a unified, high-confidence score.
* **Parallel Fan-Out:** Specialist agents evaluate the PR simultaneously, reducing total review time by up to 65%.

---

## 2. Technical Specification

### 2.1 MetaGPT Standard Operating Procedure (SOP) State Machine
```typescript
export enum SOPReviewPhase {
  FAN_OUT_ANALYSIS = 'FAN_OUT_ANALYSIS',       // Workers analyze diff in parallel
  CROSS_CRITIQUE_DEBATE = 'CROSS_CRITIQUE_DEBATE', // Synthesizer cross-examines findings
  QUALITY_GATE_SYNTHESIS = 'QUALITY_GATE_SYNTHESIS', // LLM-as-a-Judge scores final report
  EGRESS_POSTING = 'EGRESS_POSTING',             // Publish to GitHub
}
```

### 2.2 Multi-Agent Consensus Convergence Metric
$$\text{Consensus Convergence} = 1 - \frac{\text{Variance of Sub-Agent Scores}}{\text{Maximum Possible Variance}}$$

```typescript
export class MultiAgentConsensusEvaluator {
  static computeConsensus(subAgentScores: number[]): { converged: boolean; consensusScore: number } {
    const mean = subAgentScores.reduce((a, b) => a + b, 0) / subAgentScores.length;
    const variance = subAgentScores.reduce((acc, score) => acc + Math.pow(score - mean, 2), 0) / subAgentScores.length;
    const convergence = 1 - Math.min(variance, 1.0);

    return {
      converged: convergence >= 0.80,
      consensusScore: mean,
    };
  }
}
```

### 2.3 Parallel Fan-out & Refinement Orchestration
```typescript
// 1. Parallel execution
const rawReviews = await parallelRunner.runParallel(sessionId, ctx, [
  { agentName: 'security_reviewer', message: diff },
  { agentName: 'architecture_reviewer', message: diff },
  { agentName: 'quality_reviewer', message: diff },
], {
  aggregationStrategy: 'consensusMerge',
  maxConcurrency: 3,
  timeoutMs: 30000,
});

// 2. Refinement loop with quality threshold
return refinementRunner.runRefinementLoop(
  `${sessionId}_refine`,
  ctx,
  'lead_synthesizer',
  `Synthesize and polish review findings:\n${rawReviews.output}`,
  { maxIterations: 2, qualityThreshold: 0.85 }
);
```

---

## 3. Key Design Decisions

* **MetaGPT SOP Structure:** Enforces strict role definitions, preventing infinite agent debates.
* **Consensus Convergence Gate:** Flags reviews with high disagreement between security and architecture agents for human maintainer review.
