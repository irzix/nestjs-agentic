# Task 04: Multi-Agent Orchestration, Consensus Debate & Frugal Cascade

> **Implementation specification for Parallel Fan-Out, Consensus Convergence Scoring, MetaGPT SOP State Machines, and FrugalGPT Routing.**

---

## 🎯 Objective
Implement the orchestration pipeline that executes specialist sub-agents concurrently, calculates inter-agent debate consensus variance, routes models using the FrugalGPT cascade algorithm, and manages iterative refinement loops.

---

## 📁 Target Files to Create
* `src/orchestration/pr-review.orchestrator.ts`
* `src/orchestration/consensus-evaluator.service.ts`
* `src/orchestration/frugal-cascade-router.service.ts`
* `src/orchestration/sop-state-machine.ts`

---

## 📋 Detailed Technical Requirements

### 1. PR Review Orchestrator (`src/orchestration/pr-review.orchestrator.ts`)
* Coordinate the multi-phase review lifecycle:
  1. **Phase 1 (Fan-Out):** Concurrently dispatch tasks to `SecurityReviewer`, `ArchitectureReviewer`, and `QualityReviewer` using `ParallelSubAgentRunner` (`maxConcurrency: 3`, `timeoutMs: 30000`).
  2. **Phase 2 (Consensus Check):** Compute agreement variance between sub-agent scores.
  3. **Phase 3 (Refinement Loop):** Pass aggregated findings to `RefinementLoopRunner` with `LeadSynthesizerAgent` (max 2 iterations, quality threshold: 0.85).

### 2. Multi-Agent Consensus Evaluator (`src/orchestration/consensus-evaluator.service.ts`)
* Compute consensus convergence formula:
  $$\text{Consensus} = 1 - \frac{\text{Variance of Sub-Agent Scores}}{\text{Maximum Possible Variance}}$$
* If consensus $< 0.80$, mark review for maintainer cross-examination.

### 3. FrugalGPT Model Cascade Router (`src/orchestration/frugal-cascade-router.service.ts`)
* Implement two-tier cascade:
  1. Execute lightweight model (`gpt-4o-mini` / `claude-3-5-haiku`) for initial triage.
  2. If `confidenceScore >= 0.85`, return result immediately.
  3. If `confidenceScore < 0.85`, cascade execution to high-reasoning model (`gpt-4o` / `claude-3-7-sonnet`).

### 4. MetaGPT SOP State Machine (`src/orchestration/sop-state-machine.ts`)
* Define rigid phase state transitions: `FAN_OUT_ANALYSIS ➔ CROSS_CRITIQUE_DEBATE ➔ QUALITY_GATE_SYNTHESIS ➔ EGRESS_POSTING`.

---

## ✅ Acceptance Criteria & Testing
1. Parallel runner executes 3 specialist agents concurrently without deadlocks.
2. If any sub-agent times out, the orchestrator handles partial results gracefully via `allSettled`.
3. Frugal cascade correctly escalates low-confidence evaluations to the reasoning model.
4. Unit & orchestration tests pass: `npm run test:unit -- src/orchestration`
