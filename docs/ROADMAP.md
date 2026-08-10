# Product Roadmap & Architectural Vision

> **Philosophy**: nestjs-agentic is the **agentic infrastructure layer for NestJS** — not an AI wrapper on top of your backend, but governance, orchestration, and runtime binding built natively inside it. Agents are first-class NestJS citizens. Policies run before every tool call. Humans stay in control of what matters.

---

## The 4 Core Pillars

```text
                              nestjs-agentic
                                    │
   ┌────────────────────┬───────────┴────────────┬────────────────────┐
   │                    │                        │                    │
1. NestJS Primitives  2. Governance &         3. Ecosystem         4. Multi-Agent
   & DI Binding          HITL Safety             Adapters             Orchestration
   @Agent, @ToolSet,     3-state policies,       ADK, LangGraph,      Sub-agents,
   @Tool, @Context       ApprovalService         Memory, Vercel       isolated contexts
```

---

## The Agent Execution & Governance Pipeline

```text
Incoming Request
      │
      ▼
AgentRunner.run('agent-name', { sessionId, message, context })
      │
      ▼
AgentProvider.define()   ─── resolves tools and instructions
      │
      ▼
LocalToolProvider        ─── wraps each @Tool method into a ResolvedTool closure
      │
      ▼
PolicyExecutor           ─── evaluates @UsePolicies chain per tool call
      ├── allow           ──► Execute tool, return result to LLM
      ├── deny            ──► Return { status: 'denied', reason } to LLM
      └── require_approval──► Save PendingApproval, return { status: 'pending_approval', approvalId }
                                    │
                                    ▼
                            POST /approve/:id   ──► ApprovalService.approve()  ──► Execute saved closure
                            POST /reject/:id    ──► ApprovalService.reject()   ──► Discard
```

---

## Release Phases

---

### ✅ Phase 0.1 — Core Primitives & Safety Foundation

> **Status: Released**

The foundation. Every subsequent phase builds on these.

- [x] **Decorator Suite**: `@Agent()`, `@ToolSet()`, `@Tool()`, `@Param()`, `@Context()` — full NestJS DI integration.
- [x] **3-State Policy Engine**: `allow`, `deny`, `require_approval` — composable via `@UsePolicies(...policies)`.
- [x] **AgentContext Isolation**: `security.userId`, `security.tenantId`, `security.roles`, `traceId` — captured inside tool closures, never leaking through LLM prompts.
- [x] **HITL Approval Lifecycle**: `ApprovalService.approve(id)` and `ApprovalService.reject(id)` — full pending approval management.
- [x] **Google ADK Adapter**: Official `@nestjs-agentic/adk` runtime adapter for Gemini models.
- [x] **MockRuntimeAdapter**: Deterministic unit testing of agents, tools, and policies — no LLM API keys required.
- [x] **Modular Architecture**: `@nestjs-agentic/core`, `@nestjs-agentic/adk`, and `nestjs-agentic` meta-package via `AgenticModule.forRoot()` / `forFeature()`.

---

### 🔥 Phase 0.2 — Enterprise Governance Matrix, Cognitive Memory & Ecosystem

> **Status: Released (v0.2.5)**

Where nestjs-agentic becomes irreplaceable for enterprise teams.

#### 🛡️ Advanced Governance & Multi-Tenant Safety

- [x] **NestJS 11 & NestJS 10 Support** — full peerDependency compatibility across all monorepo packages (`^10.0.0 || ^11.0.0`).
- [x] **Unified StateStore Architecture** — core `StateStore` abstraction with built-in `InMemoryStateStore` and `RedisStateStore` registered centrally via `AgenticModule.forRoot({ stateStore })`.
- [x] **Built-in Policy Utilities**:
  - `RateLimitPolicy` — sliding-window call frequency enforcement per tenant/user.
  - `CostLimitPolicy` — multi-threshold financial evaluation (`allow` -> `require_approval` -> `deny`).
- [x] **Structured Event Streaming (`runStream()`)** — typed `AgentStreamEvent` union (`tool_start`, `tool_result`, `approval_required`, `token`, `complete`) for Server-Sent Events (SSE).

#### 🧠 Cognitive Memory Module (`@nestjs-agentic/memory`)

- [x] **Multi-Tier Memory Architecture**:
  - `ShortTermMemory` — sliding-window conversation history with configurable token caps (`maxMessages`).
  - `ScratchpadMemory` — active working task set & file buffer for session execution.
  - `SemanticMemory` — pluggable semantic store with `SemanticStoreProvider` & `BasicSemanticStore`.
  - `EpisodicMemory` — timeline event trajectory history.
  - `TokenBudgetSummarizer` — automatic token budget estimation and hierarchical summary generator.
  - `CompositeMemory` — unified multi-tier memory store interface.

#### 🔌 Ecosystem Adapters & Transports

- [x] **`@nestjs-agentic/langgraph`** — LangGraph runtime adapter with stateful `BaseCheckpointSaver` thread persistence (`MemorySaver`, `SqliteSaver`, `Redis`).
- [ ] **`@nestjs-agentic/vercel`** — Vercel AI SDK runtime adapter with streaming support.
- [ ] **MCP Transport** — Model Context Protocol `ToolProvider` for exposing tools to external MCP-compatible servers and clients.

---

### ✅ Phase 0.3 — Production-Grade RAG Engine, Knowledge Graph & Cognitive Experience

> **Status: Released (v0.3.0)**

- [x] **`@nestjs-agentic/rag` Package** — Enterprise, domain-agnostic RAG engine with 7 modular strategies:
  - `QueryExpansionStrategy` — Custom dictionary synonym expansion + LLM sub-queries.
  - `HierarchicalRAGStrategy` — Markdown header section node tree rollup & sibling aggregation.
  - `ParentChildHydrationStrategy` — Parent context hydration without raw text duplication.
  - `LateChunkingStrategy` — Blending global document vector context with chunk vectors ($\alpha = 0.7$).
  - `ContextualCompressionStrategy` — Zero-latency extractive sentence selection & boundary truncation.
  - `GraphRAGStrategy` — Sub-graph multi-hop entity traversal, fuzzy `searchNodes` matching, and Graph-Guided Chunk Score Boosting.
  - `RerankerStrategy` — Term frequency scoring + custom Cross-Encoder model (`rerankFn`) support.
- [x] **`HybridVectorStore`** — Cosine similarity, Min-Max score normalization, multi-tenant metadata filtering, and `@nestjs-agentic/memory` `SemanticStoreProvider` compatibility.
- [x] **`InMemoryKnowledgeGraphProvider`** — Zero-dependency multi-hop entity relationship provider.
- [x] **`@nestjs-agentic/experience`** — Trajectory reflection and experience learning layer (`ExperienceLearner`, `ReflectionEngine`) for self-correcting prompt guidance.

---

### ✅ Phase 0.4 — Multi-Agent Orchestration & Mathematical Evaluation Framework

> **Status: Released (v0.4.0)**

- [x] **`@nestjs-agentic/orchestration` Package**:
  - `SubAgentDelegator` — Sub-agent context propagation and tenant security isolation.
  - `ParallelSubAgentRunner` — Concurrent `Promise.all` fan-out runner with timeout protection, retries, fallback sub-agent recovery, and score-weighted consensus.
  - `RefinementLoopRunner` — Iterative supervisor-worker feedback loops with versioned sub-session memory (`parentSessionId:agentName:iter_N`) and satisfaction criteria.
- [x] **`@nestjs-agentic/evaluation` Package**:
  - `AccuracyGroundTruthMetric` — Mathematical accuracy scoring via Vector Cosine Similarity and Sørensen-Dice Token Similarity.
  - `ExecutionEfficiencyMetric` — Weighted multi-variable ratios (step count ratio, latency ratio, token consumption ratio).
  - `SafetyPolicyMetric` — Security policy adherence and forbidden tool call detection.
  - `TrajectoryInspectorMetric` — Verification of tool call sequences and argument schema assertions.
  - `LLMAsAJudgeMetric` — LLM judge evaluation.
  - `BenchmarkRunner` — Dataset suite benchmark runner with Multi-Trial Variance Analysis ($\mu$ mean score and $\sigma$ standard deviation).
  - `EvalReporter` — GitHub-Flavored Markdown benchmark report generator.
- [x] **Monorepo-Wide TSDoc Audit** — Comprehensive `/** ... */` TSDoc comments across core, memory, experience, rag, orchestration, and evaluation packages.

---

### 📡 Phase 0.5 — Observability, Immutable Audit & Transports

> **Status: Active Development**

- [ ] **Immutable Audit Trail (`AuditEventStore`)** — persistent, append-only log of all policy decisions, tool executions, approvals, and rejections.
- [ ] **AgentObserver Interface** — pluggable observer hooks (`OpenTelemetry`, `Langfuse`).
- [ ] **`@nestjs-agentic/vercel`** — Vercel AI SDK runtime adapter with streaming support.
- [ ] **MCP Transport** — Model Context Protocol `ToolProvider` for exposing tools to external MCP-compatible servers and clients.

---

## Design Principles

These principles guide every decision in the roadmap:

1. **NestJS-Native First** — If it doesn't fit into the NestJS module system naturally, we don't ship it.
2. **Governance is Non-Optional** — Every tool call passes through the policy engine. There is no bypass.
3. **Context Isolation by Default** — `AgentContext` is pre-bound inside closures. LLMs never have access to raw security data.
4. **Vendor-Agnostic Runtime** — The `RuntimeAdapter` interface decouples tool definitions from LLM providers entirely.
5. **Testable Without LLMs** — `MockRuntimeAdapter` ensures every governance decision is testable in CI without API keys or network calls.
