# Implementation Tasks & Verification Matrix for Njent

> **Step-by-step technical task breakdown for implementing the Njent Code Review Agent in `src/`.**

---

## 1. Task Breakdown Matrix

### Phase 1: Ingress, Security & Context Layer
- [ ] **Task 1.1:** Implement `src/webhooks/webhook.controller.ts` for fast GitHub webhook ingress (< 200ms ACK).
- [ ] **Task 1.2:** Implement `src/guards/collaborator.guard.ts` (HMAC-SHA256 signature verification & Collaborator RBAC check).
- [ ] **Task 1.3:** Implement `src/ingestion/context-pruner.ts` (stripping `.lock`, `.json`, `.min.js` and noisy binary diffs).
- [ ] **Task 1.4:** Implement `src/context/u-curve-prompt-assembler.ts` (Stanford U-Shaped attention prompt ordering).

### Phase 2: AST Codebase RAG & Hybrid Search Pipeline
- [ ] **Task 2.1:** Implement `src/ingestion/ast-splitter.ts` using `ts-morph` for AST-aware class and interface chunking.
- [ ] **Task 2.2:** Implement `src/stores/postgres-codebase.store.ts` managing `codebase_chunks` table with `HNSW` and `GIN` indexes.
- [ ] **Task 2.3:** Implement `src/rag/rag-pipeline.service.ts` with Query Expansion, Parent-Child Hydration, and RRF Hybrid search.
- [ ] **Task 2.4:** Implement `src/rag/graph-dependency.service.ts` for cross-package import graph traversal.

### Phase 3: Specialist Agents & Supervisor
- [ ] **Task 3.1:** Implement `src/agents/security-reviewer.agent.ts` with domain-isolated security prompts.
- [ ] **Task 3.2:** Implement `src/agents/architecture-reviewer.agent.ts` checking `nestjs-agentic` DI patterns and roadmap rules.
- [ ] **Task 3.3:** Implement `src/agents/quality-reviewer.agent.ts` auditing complexity, async promises, and TypeScript typing.
- [ ] **Task 3.4:** Implement `src/agents/lead-synthesizer.agent.ts` with the formal ReAct trajectory loop.
- [ ] **Task 3.5:** Implement `src/agents/code-fixer.agent.ts` generating unified diffs for automated repairs.

### Phase 4: Multi-Agent Orchestration & Refinement
- [ ] **Task 4.1:** Implement `src/orchestration/pr-review.orchestrator.ts` managing the parallel fan-out of specialist workers.
- [ ] **Task 4.2:** Implement `src/orchestration/consensus-evaluator.ts` calculating variance across sub-agent reviews.
- [ ] **Task 4.3:** Implement `src/orchestration/frugal-router.service.ts` (Stanford FrugalGPT model cascading router).

### Phase 5: Governance, Policies & Human-in-the-Loop
- [ ] **Task 5.1:** Implement `src/policies/require-maintainer-approval.policy.ts` intercepting state mutations.
- [ ] **Task 5.2:** Implement `src/policies/protected-paths.policy.ts` preventing automated modification to CI workflows.
- [ ] **Task 5.3:** Implement `src/stores/redis-idempotency.store.ts` with atomic `NX` key claiming.
- [ ] **Task 5.4:** Implement `src/controllers/approval.controller.ts` providing the `POST /approvals/:id/settle` endpoint.

### Phase 6: Evaluation Quality Gates & MCP Sandbox
- [ ] **Task 6.1:** Implement `src/evaluation/review-quality-evaluator.ts` with position-bias mitigation.
- [ ] **Task 6.2:** Implement `src/tools/sandbox-mcp.provider.ts` for running sandboxed `tsc` and `jest` tests via MCP.
- [ ] **Task 6.3:** Implement `src/tools/github-tools.service.ts` wrapping Octokit PR comments and diff fetching.

### Phase 7: Memory, Experience & Observability
- [ ] **Task 7.1:** Implement `src/memory/stanford-memory-scorer.ts` (Tri-factor Recency, Importance, Relevance scoring).
- [ ] **Task 7.2:** Implement `src/memory/reflection-engine.service.ts` (MIT Reflexion verbal feedback engine).
- [ ] **Task 7.3:** Implement `src/audit/postgres-audit.sink.ts` with OpenTelemetry GenAI semantic attributes.

---

## 2. Verification & Automated Testing Plan

| Verification Suite | Target Component | Command | Expected Outcome |
|---|---|---|---|
| **Contract Suite** | Storage & Adapters | `npm run test:contracts` | All session, idempotency, and approval stores pass contract suites. |
| **Unit Tests** | AST Parser & RAG | `npm run test:unit` | AST splitter correctly extracts classes and methods with zero syntax loss. |
| **Orchestration Tests** | Fan-Out & Refinement | `npm run test:orchestration` | Parallel runner terminates within 30s deadline; consensus score computes correctly. |
| **Security Tests** | Ingress & Injection | `npm run test:security` | Canary tokens detected; unauthorized webhooks dropped in < 20ms. |
| **End-to-End Test** | Full PR Review Flow | `npm run test:e2e` | Complete mock turn executes, evaluates quality rubric, and posts verified review. |
