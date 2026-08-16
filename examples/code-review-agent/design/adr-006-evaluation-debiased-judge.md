# ADR 006: Pre-Egress Quality Gate with Position-Debiased LLM-as-a-Judge

## Status
**ACCEPTED** (2026-08-16)

---

## Context & Problem Statement
Posting automated AI code reviews directly to public GitHub pull requests without quality validation leads to severe developer frustration:
1. **Hallucinated Line Numbers & File Paths:** LLMs frequently reference nonexistent line numbers or files that were not modified in the PR diff.
2. **Pedantic or Destructive Tone:** Inappropriate, unconstructive, or rude comments erode developer trust.
3. **Position Bias in LLM Judges:** Academic research (*Zheng et al., UC Berkeley LMSYS, NeurIPS 2023 - MT-Bench*) proves that LLM judges suffer from significant **Position Bias** (systematically favoring whichever candidate text appears first in the evaluation prompt).

---

## Decision
We choose a **Two-Tier Pre-Egress Quality Gate** combining **Deterministic Diff Boundary Validation** with **Position-Debiased LLM-as-a-Judge Evaluation**.

```
                        Drafted Review from LeadSynthesizer
                                        │
                                        ▼
       ┌────────────────────────────────────────────────────────────────┐
       │              Tier 1: Deterministic Boundary Gate               │
       ├────────────────────────────────────────────────────────────────┤
       │ 1. Line Existence: Validate every line number against git diff │
       │ 2. Path Existence: Validate every filePath exists in PR diff   │
       │ 3. Schema Check: Validate Zod structured review payload        │
       └────────────────────────┬───────────────────────────────────────┘
                                │ (If Passed)
                                ▼
       ┌────────────────────────────────────────────────────────────────┐
       │        Tier 2: Position-Debiased LLM-as-a-Judge Gate           │
       ├────────────────────────────────────────────────────────────────┤
       │ Round 1: Evaluate candidate review (Forward Ordering)          │
       │ Round 2: Evaluate candidate review (Reverse Ordering)          │
       │                                                                │
       │ Formula: FinalScore = (Score_Forward + Score_Reverse) / 2      │
       │ Quality Threshold: FinalScore >= 0.85                          │
       └────────────────────────┬───────────────────────────────────────┘
                                │
                 ┌──────────────┴──────────────┐
           [Score >= 0.85]               [Score < 0.85]
                 ▼                             ▼
       Publish to GitHub PR         Trigger RefinementLoopRunner
                                    (Self-Correction Iteration)
```

### Key Technical Choices:
1. **Deterministic Line Verification:** Extracts all `(filePath, lineNumber)` tuples from the drafted report and asserts their existence in the raw unified git diff before invoking any model judge.
2. **Pairwise Position-Swapping Protocol:** Evaluates drafted suggestions in forward and reversed order, computing the arithmetic mean to neutralize primacy/recency bias.
3. **Structured 3-Dimension Rubric:**
   * **Line Validity (Binary):** All referenced lines are real. (Fatal if false).
   * **Technical Actionability (0.0–1.0):** Provides clear rationale, context, and actionable TypeScript fix snippet.
   * **Professional Tone (0.0–1.0):** Constructive, respectful, and free of pedantic nitpicks.
4. **Automated Refinement Re-entry:** Reviews scoring $< 0.85$ are fed back to `LeadSynthesizerAgent` with the judge's critique for a single refinement iteration.

---

## Alternatives Considered

| Alternative | Advantages | Disadvantages / Rejection Reason |
|---|---|---|
| **Direct Unchecked Posting** | Fast; zero extra LLM calls. | High rate of hallucinated lines; risks embarrassing false positives on public PRs. |
| **Single-Pass LLM Judge** | Fast evaluation. | Suffers from up to 25% variance due to position bias; inconsistent scoring. |
| **Pure Regex Linting** | Instantaneous. | Cannot evaluate technical depth, logical validity, or semantic constructiveness of recommendations. |

---

## Consequences & Trade-offs
* **Positive:** Completely eliminates hallucinated line numbers; guarantees high review quality and constructive tone; mathematically debiased evaluation.
* **Negative:** Adds one additional model call (~300–500ms) before posting final review comments.
