# @nestjs-agentic/evaluation

Evaluation, benchmarking, position-debiasing, and trajectory inspection primitives for autonomous NestJS AI agents.

## Overview

The `@nestjs-agentic/evaluation` package provides rigorous statistical benchmarking and quality evaluation tools for AI agents built with `nestjs-agentic`.

### Core Capabilities

- **Pairwise Position-Debiased LLM-as-a-Judge (`PairwiseDebiasedJudge`)**:
  - Implements the position-swap debiasing protocol from UC Berkeley LMSYS (*Zheng et al., NeurIPS 2023 — MT-Bench*).
  - Evaluates candidate agent responses in forward $(A, B)$ and reverse $(B, A)$ positions to detect and eliminate systematic primacy/recency bias.
- **Trajectory Efficiency & Tool Precision Metrics (`TrajectoryInspectorMetric`, `ToolPrecisionMetric`)**:
  - Implements trajectory evaluation protocols from Tsinghua University (*Liu et al., ICLR 2024 — AgentBench*).
  - **Step Efficiency:** Computes ratio of minimal optimal steps to executed steps ($E_{\text{step}} = N_{\text{optimal}} / N_{\text{actual}}$).
  - **Tool Precision:** Computes ratio of error-free tool invocations ($P_{\text{tool}} = N_{\text{successful}} / N_{\text{total}}$).
- **Safety Policy Compliance (`SafetyPolicyMetric`)**:
  - Validates forbidden tools, RBAC/ABAC policy adherence, and unauthorized invocation attempts.
- **Accuracy Ground Truth (`AccuracyGroundTruthMetric`)**:
  - Vector cosine similarity and Sørensen-Dice token overlap metrics.
- **Benchmark Suite Runner (`BenchmarkRunner`) & Reporting (`EvalReporter`)**:
  - Multi-trial variance analysis ($\mu$, $\sigma$, pass-rate) with automated Markdown/JSON benchmark reports.

---

## Installation

```bash
npm install @nestjs-agentic/evaluation nestjs-agentic
```

---

## Quick Start

### 1. Pairwise Position-Debiased Evaluation (MT-Bench)

```typescript
import { runPairwiseDebiasedJudge } from '@nestjs-agentic/evaluation';

const result = await runPairwiseDebiasedJudge(
  {
    query: 'How to handle idempotency in banking transactions?',
    candidateA: {
      id: 'agent_cascade_frugal',
      output: 'Use distributed unique idempotency keys with atomic DB locking.',
    },
    candidateB: {
      id: 'agent_legacy',
      output: 'Just check if the transfer exists in memory.',
    },
    criteria: 'Technical accuracy, robustness, and architectural soundness.',
  },
  async (query, first, second, criteria) => {
    // Invoke your preferred LLM judge model (e.g. OpenAI / Anthropic)
    const judgeVerdict = await modelAdapter.generate({
      system: 'You are an impartial judge evaluating two technical answers.',
      prompt: `Task: ${query}\nCandidate 1: ${first.output}\nCandidate 2: ${second.output}`,
    });
    return parseJudgeVerdict(judgeVerdict);
  },
);

console.log('Winner:', result.winner); // 'candidate_a'
console.log('Debiased Score A:', result.debiasedScoreA);
console.log('Position Bias Detected:', result.positionBiasDetected);
```

### 2. Trajectory Efficiency & Tool Precision Inspection (AgentBench)

```typescript
import {
  ToolPrecisionMetric,
  TrajectoryInspectorMetric,
} from '@nestjs-agentic/evaluation';

const inspector = new TrajectoryInspectorMetric({ penalizeExtraSteps: true });
const precisionMetric = new ToolPrecisionMetric({ minPrecisionThreshold: 0.8 });

const evalItem = {
  id: 'transfer_task',
  query: 'Transfer $500 to account ACC-2',
  optimalSteps: 2,
  expectedToolSequence: ['checkBalance', 'transferFunds'],
  expectedToolArgs: {
    transferFunds: { amount: 500 },
  },
};

const inspectorResult = inspector.evaluate(evalItem, agentResult);
const precisionResult = precisionMetric.evaluate(evalItem, agentResult);

console.log('Trajectory Passed:', inspectorResult.passed);
console.log('Step Efficiency:', inspectorResult.details.stepEfficiency);
console.log('Tool Precision:', precisionResult.details.precision);
```

---

## Academic References

1. **MT-Bench / LMSYS:** Zheng et al., *"Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena"* (UC Berkeley LMSYS, NeurIPS 2023, [arXiv:2306.05685](https://arxiv.org/abs/2306.05685))
2. **AgentBench:** Liu et al., *"AgentBench: Evaluating Large Language Models as Agents"* (Tsinghua University, ICLR 2024, [arXiv:2308.03688](https://arxiv.org/abs/2308.03688))

---

## License

[MIT](https://github.com/irzix/nestjs-agentic/blob/main/LICENSE) © [irzix](https://github.com/irzix)
