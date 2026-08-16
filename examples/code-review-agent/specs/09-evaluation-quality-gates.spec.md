# 09 — Evaluation & Quality Gates Specification
> **How Njent validates review comments, executes code tests, and mitigates Position Bias in LLM-as-a-Judge.**

---

## 📚 Academic & Research Foundations
* **Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena** — *Zheng et al., UC Berkeley LMSYS (NeurIPS 2023)* ([arXiv:2306.05685](https://arxiv.org/abs/2306.05685)).
* **AgentBench: Evaluating Large Language Models as Agents** — *Liu et al., Tsinghua University (ICLR 2024)* ([arXiv:2308.03688](https://arxiv.org/abs/2308.03688)).

---

## 1. Conceptual Mapping in Njent

* **Step & Trajectory Evaluation:** Evaluates whether sub-agents called the correct tools without hallucinated parameters.
* **LLM-as-a-Judge with Position Bias Mitigation:** Running candidate reviews through a structured rubric with position swapping to eliminate primacy bias in judgment.
* **Code & Test Validation:** When generating automated fixes (`@njent apply-fixes`), runs `tsc --noEmit` and `jest --findRelatedTests` in a self-correction loop.
* **Long-Term Benchmarking:** Measures maintainer acceptance rate (MAR) and false-positive rates via `@nestjs-agentic/evaluation`.

---

## 2. Technical Specification

### 2.1 LLM-as-a-Judge with Position Bias Mitigation (`ReviewQualityEvaluator`)
Implements the pairwise evaluation and position-swap protocol from *Zheng et al. (UC Berkeley)*:

```typescript
import { Injectable } from '@nestjs/common';
import { ModelAdapter } from '@nestjs-agentic/core';

@Injectable()
export class ReviewQualityEvaluator {
  constructor(private readonly model: ModelAdapter) {}

  async evaluateWithDebias(prDiff: string, candidateReview: string): Promise<{ passed: boolean; score: number }> {
    // Round 1: Forward evaluation
    const score1 = await this.judgePrompt(prDiff, candidateReview, 'Forward');
    // Round 2: Reverse/Swapped baseline comparison to mitigate Position Bias
    const score2 = await this.judgePrompt(prDiff, candidateReview, 'Reverse');

    const finalScore = (score1 + score2) / 2;
    return { score: finalScore, passed: finalScore >= 0.85 };
  }

  private async judgePrompt(diff: string, review: string, order: 'Forward' | 'Reverse'): Promise<number> {
    const prompt = `You are an impartial Code Review Quality Judge. Order: ${order}
Rubric:
1. Line Existence: Every referenced line must exist in diff. (Fatal if false)
2. Actionability: Must provide clear technical explanation and snippet.
3. Tone: Professional and constructive.

Diff: ${diff}
Review: ${review}
Output JSON: { "score": 0.0-1.0, "passed": boolean }`;

    const res = await this.model.execute({
      messages: [{ role: 'user', content: prompt }],
      options: { responseFormat: 'json_object' },
    });
    return JSON.parse(res.content).score;
  }
}
```

### 2.2 Trajectory & Step-Level Metric Formulas
$$\text{Trajectory Efficiency} = \frac{\text{Minimum Necessary Tool Turns}}{\text{Actual Executed Turns}}$$
$$\text{Tool Precision} = \frac{\text{Valid Non-Error Tool Calls}}{\text{Total Tool Invocations}}$$

---

## 3. Key Design Decisions

* **Position-Debiasing:** Eliminates false rejections caused by LLM judge ordering preferences.
* **Self-Correction on Code Fixes:** Automatically feeds compiler errors back to `CodeFixerAgent` before prompting human review.
