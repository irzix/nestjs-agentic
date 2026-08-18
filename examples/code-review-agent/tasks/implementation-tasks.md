# Implementation Tasks & Verification Matrix for Njent

> **Step-by-step technical task breakdown for implementing the Njent Code Review Agent in `src/`.**

---

## 1. Task Breakdown Matrix

### Phase 1: Ingress, Security & Context Layer
- [x] **Task 1.1:** Implement `src/webhooks/webhook.controller.ts` for fast GitHub webhook ingress (< 200ms ACK).
- [x] **Task 1.2:** Implement `src/guards/collaborator.guard.ts`, `src/guards/github-signature.guard.ts`, and `src/guards/rate-limiter.guard.ts` (HMAC-SHA256 signature verification & Collaborator RBAC check).
- [x] **Task 1.3:** Implement `src/ingestion/context-pruner.ts` (stripping `.lock`, `.json`, `.min.js` and noisy binary diffs).
- [x] **Task 1.4:** Implement `src/context/u-curve-prompt-assembler.ts` (Stanford U-Shaped attention prompt ordering via `UCurveContextFormatter`).

### Phase 2: AST Codebase RAG & Hybrid Search Pipeline
- [x] **Task 2.1:** Implement `src/rag/codebase-rag.service.ts` using `@nestjs-agentic/rag` `AstCodebaseSplitter` for AST-aware class and interface chunking.
- [x] **Task 2.2:** Configure `KnowledgeBase` and `HybridVectorStore` with semantic cosine similarity.
- [x] **Task 2.3:** Implement `RAGPipeline` with `QueryExpansionStrategy`, `ParentChildHydrationStrategy`, and `UShapedContextStrategy`.
- [x] **Task 2.4:** Implement `GraphDependencyStrategy` with `InMemoryKnowledgeGraphProvider` for cross-package import graph traversal.

### Phase 3: Specialist Agents & Supervisor
- [x] **Task 3.1:** Implement `src/agents/security-reviewer.agent.ts` with domain-isolated security prompts.
- [x] **Task 3.2:** Implement `src/agents/architecture-reviewer.agent.ts` checking `nestjs-agentic` DI patterns and roadmap rules.
- [x] **Task 3.3:** Implement `src/agents/quality-reviewer.agent.ts` auditing complexity, async promises, and TypeScript typing.
- [x] **Task 3.4:** Implement `src/agents/lead-synthesizer.agent.ts` with structured decision synthesis (APPROVED vs CHANGES_REQUESTED).
- [x] **Task 3.5:** Implement `src/agents/code-fixer.agent.ts` generating unified diffs for automated repairs.

### Phase 4: Multi-Agent Orchestration & Refinement
- [x] **Task 4.1:** Implement `src/orchestration/pr-review.orchestrator.ts` managing the parallel fan-out of specialist workers via `ParallelSubAgentRunner`.
- [x] **Task 4.2:** Implement `src/orchestration/consensus-evaluator.service.ts` calculating mathematical variance and consensus across sub-agent reviews.
- [x] **Task 4.3:** Integrate `ModelCascadeRouter` / `ModelCascadeAdapter` for confidence-based model tiering.

### Phase 5: Governance, Policies & Human-in-the-Loop
- [x] **Task 5.1:** Implement `src/policies/require-maintainer-approval.policy.ts` intercepting state mutations.
- [x] **Task 5.2:** Implement `src/policies/protected-paths.policy.ts` preventing automated modification to CI workflows and config files.
- [x] **Task 5.3:** Integrate `InMemoryApprovalStore` / `RedisApprovalStore` and `ApprovalService`.
- [x] **Task 5.4:** Implement `src/controllers/approval.controller.ts` providing the `POST /approvals/:id/settle` endpoint.

### Phase 6: Evaluation Quality Gates & MCP Sandbox
- [x] **Task 6.1:** Implement `src/evaluation/review-quality-evaluator.service.ts` using `PairwiseDebiasedJudge` with MT-Bench position-bias mitigation and diff boundary validation.
- [x] **Task 6.2:** Integrate `McpClient` / `McpToolProvider` for running sandboxed commands.
- [x] **Task 6.3:** Implement `src/tools/github-octokit.tools.ts` (`@ToolSet({ name: 'github' })`) for PR diffs, review comments, and fix branch creation.

### Phase 7: Memory, Experience & Observability
- [x] **Task 7.1:** Implement `src/memory/experience-learner.service.ts` with `StanfordMemoryScorer` ($S = w_{\text{rec}} S_{\text{rec}} + w_{\text{imp}} S_{\text{imp}} + w_{\text{rel}} S_{\text{rel}}$).
- [x] **Task 7.2:** Integrate `ExperienceLearner` to record false-positive feedback and prevent repeated mistakes.
- [x] **Task 7.3:** Implement `src/audit/njent-audit-logger.service.ts` with OpenTelemetry GenAI semantic attributes.

### Phase 8: End-to-End Testing & Verification
- [x] **Task 8.1:** Implement master unit test suite `test/unit.spec.ts` executing all 8 task test suites.
- [x] **Task 8.2:** Implement full-stack integration test `test/njent-e2e.spec.ts` verifying all 6 stages of the review lifecycle.

---

## 2. Verification & Automated Testing Plan

| Verification Suite | Target Component | Command | Outcome |
|---|---|---|---|
| **Phase 1 Test** | Ingress, Security & Context | `node dist/test/test/task-01-ingress.spec.js` | ✅ PASS (7/7 tests passed) |
| **Phase 2 Test** | AST Codebase RAG & Graph | `node dist/test/test/task-02-rag.spec.js` | ✅ PASS (3/3 tests passed) |
| **Phase 3 Test** | Specialist Agents & Synthesis | `node dist/test/test/task-03-agents.spec.js` | ✅ PASS (4/4 tests passed) |
| **Phase 4 Test** | Orchestration & Consensus | `node dist/test/test/task-04-orchestration.spec.js` | ✅ PASS (3/3 tests passed) |
| **Phase 5 Test** | Governance Policies & HITL | `node dist/test/test/task-05-governance.spec.js` | ✅ PASS (3/3 tests passed) |
| **Phase 6 Test** | Evaluation & GitHub Tools | `node dist/test/test/task-06-evaluation.spec.js` | ✅ PASS (3/3 tests passed) |
| **Phase 7 Test** | Cognitive Memory & Audit | `node dist/test/test/task-07-memory.spec.js` | ✅ PASS (3/3 tests passed) |
| **Full E2E Suite** | Complete PR Review Lifecycle | `node dist/test/test/njent-e2e.spec.js` | ✅ PASS (6/6 stages passed) |
