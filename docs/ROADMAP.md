# Product Roadmap

This roadmap outlines the evolution, release milestones, and forward direction of `nestjs-agentic`.

---

## 📚 Architectural Foundations & Research References

`nestjs-agentic` is engineered in strict alignment with peer-reviewed academic literature and enterprise AI systems standards:

* **ReAct Reasoning:** *Yao et al., Princeton & Google Brain (ICLR 2023)* ([arXiv:2210.03629](https://arxiv.org/abs/2210.03629))
* **Tool Calling & MCP:** *Schick et al., Meta AI (Toolformer, arXiv:2302.04761)* & *Anthropic Model Context Protocol Standard*
* **Multi-Agent SOPs & Debate:** *Hong et al. (MetaGPT, ICLR 2024, arXiv:2308.00352)* & *Du et al., MIT (arXiv:2305.14325)*
* **Context Engineering & Lost in the Middle:** *Liu et al., Stanford & UC Berkeley (TACL 2024, arXiv:2307.03172)*
* **GraphRAG & Knowledge Traversal:** *Edge et al., Microsoft Research (arXiv:2404.16130)* & *Lewis et al. (NeurIPS 2020)*
* **Cognitive Memory & Reflection:** *Park et al., Stanford (Generative Agents, arXiv:2304.03442)* & *Shinn et al., MIT (Reflexion, NeurIPS 2023)*
* **Evaluation & Debiasing:** *Zheng et al., UC Berkeley LMSYS (MT-Bench, NeurIPS 2023, arXiv:2306.05685)*
* **Cost Optimization via Model Cascades:** *Chen et al., Stanford University (FrugalGPT, arXiv:2305.05176)*
* **Security & Tri-Rail Guardrails:** *Rebedea et al., NVIDIA (arXiv:2310.10501)* & *Greshake et al. (USENIX Security 2023)*

---

## Package Architecture Status

| Package | Status | Role |
|---|---|---|
| [`nestjs-agentic`](packages/meta) | **Available (v1.0.0 GA)** | Umbrella meta-package providing zero-config exports for all core primitives. |
| [`@nestjs-agentic/core`](packages/core) | **Available (v1.0.0 GA)** | Governed runtime, DI discovery, tool policies, streaming, HITL approvals, execution budgets, and state stores. |
| [`@nestjs-agentic/openai`](packages/model-openai) | **Available (v1.0.0 GA)** | Direct model adapter for OpenAI and ChatCompletions-compatible endpoints (Ollama, vLLM, Groq, OpenRouter, Azure). |
| [`@nestjs-agentic/memory`](packages/memory) | **Available (v1.0.0 GA)** | 5-tier cognitive memory architecture with Stanford tri-factor scoring, working scratchpads, and episodic reflection. |
| [`@nestjs-agentic/rag`](packages/rag) | **Available (v1.0.0 GA)** | Context engineering engine with AST code chunking, hybrid BM25 + vector search, GraphRAG, and cross-encoder rerankers. |
| [`@nestjs-agentic/orchestration`](packages/orchestration) | **Available (v1.0.0 GA)** | Multi-agent delegation, bounded concurrency fan-out, supervisor refinement loops, and multi-agent debate consensus. |
| [`@nestjs-agentic/evaluation`](packages/evaluation) | **Available (v1.0.0 GA)** | Position-debiased LLM-as-a-Judge benchmarking suite, trajectory scorers, and CI/CD quality gates. |
| [`@nestjs-agentic/mcp`](packages/mcp) | **Available (v1.0.0 GA)** | Model Context Protocol integration providing standardized stdio/SSE client transports and dynamic tool providers. |

---

## Delivered Milestones

### 0.5 — Independent Agent Runtime

> **Status: Complete**

Goal: run a complete, governed agent turn without requiring LangGraph or external orchestration frameworks.

- [x] Define vendor-neutral model, message, tool-call, and usage contracts (`ModelAdapter`).
- [x] Implement the complete model-to-tool loop: model response, governed tool execution, tool results, and final response (`AgentExecutor`).
- [x] Stream model tokens and governed tool lifecycle events through the shared event union.
- [x] Add cancellation, deadlines, and configurable execution budgets (`ExecutionLimits`, `AbortSignal`).
- [x] Validate tool arguments against declared parameters before invoking application methods.
- [x] Recover from tool exceptions by reporting them to the model, while keeping framework errors fatal.
- [x] Ship at least one production-intent direct model adapter (`@nestjs-agentic/openai`).
- [x] Publish a reusable behavioral contract-test suite for third-party adapters (`runModelAdapterContract`).

---

### 0.6 — Durable and Observable Execution

> **Status: Complete** | [Milestone 0.6](https://github.com/irzix/nestjs-agentic/milestone/2)

Goal: make executions safe to pause, recover, inspect, and operate in production environments.

- [x] Persist and replay conversation history per session, scoped by tenant.
- [x] Add idempotency support and safe retry behavior for side-effecting tools (`RedisIdempotencyStore`, `PostgresIdempotencyStore`, `IdempotencyPolicy`).
- [x] Publish reusable behavioral contract suites for approval, session, and idempotency stores.
- [x] Introduce durable, versioned execution checkpoints and mid-round turn recovery ([#33](https://github.com/irzix/nestjs-agentic/issues/33)).
- [x] Propagate cancellation (`AbortSignal`) and deadlines through runtime, tools, and stores ([#31](https://github.com/irzix/nestjs-agentic/issues/31)).
- [x] Implement Tri-Rail Guardrails with post-execution tool output sanitization and canary tokens ([#49](https://github.com/irzix/nestjs-agentic/issues/49)).
- [x] PostgreSQL persistence adapters for state, session, approval, and idempotency stores ([#34](https://github.com/irzix/nestjs-agentic/issues/34)).
- [x] Standardize formal ReAct event lifecycles (`thought`, `action_call`, `observation`) and OpenTelemetry GenAI attributes ([#32](https://github.com/irzix/nestjs-agentic/issues/32), [#56](https://github.com/irzix/nestjs-agentic/issues/56)).
- [x] Integration test suite for crash recovery and HITL approvals ([#30](https://github.com/irzix/nestjs-agentic/issues/30)).

---

### 0.7 — Reliable Orchestration

> **Status: Complete** | [Milestone 0.7](https://github.com/irzix/nestjs-agentic/milestone/3)

Goal: build multi-agent coordination on the same guarantees as single-agent execution.

- [x] Cancellation-aware fan-out and bounded parallel execution (`maxConcurrency` in `ParallelSubAgentRunner`) ([#35](https://github.com/irzix/nestjs-agentic/issues/35)).
- [x] Implement MetaGPT Standard Operating Procedures (SOPs) and Multi-Agent Debate Consensus ([#53](https://github.com/irzix/nestjs-agentic/issues/53), [#36](https://github.com/irzix/nestjs-agentic/issues/36)).
- [x] Make refinement loops budget-aware, checkpointed, and resumable ([#37](https://github.com/irzix/nestjs-agentic/issues/37)).
- [x] Preserve tenant identity and support capability narrowing in sub-agent delegation ([#38](https://github.com/irzix/nestjs-agentic/issues/38)).
- [x] Resilient error recovery and evaluator-driven sub-agent selection.

---

### 0.8 — Ecosystem & Production Adapters

> **Status: Complete** | [Milestone 0.8](https://github.com/irzix/nestjs-agentic/milestone/4)

Goal: deliver production ecosystem adapters, GraphRAG, advanced memory, and cost optimization.

- [x] Dedicated `@nestjs-agentic/mcp` package for Model Context Protocol client transport ([#41](https://github.com/irzix/nestjs-agentic/issues/41)).
- [x] AST-aware codebase chunking and GraphRAG dependency traversal in `@nestjs-agentic/rag` ([#51](https://github.com/irzix/nestjs-agentic/issues/51)).
- [x] U-Shaped context assembler utility to mitigate Lost-in-the-Middle degradation ([#52](https://github.com/irzix/nestjs-agentic/issues/52)).
- [x] Stanford tri-factor memory retrieval scoring and procedural memory stores ([#50](https://github.com/irzix/nestjs-agentic/issues/50)).
- [x] FrugalGPT model cascading and confidence-threshold routing ([#54](https://github.com/irzix/nestjs-agentic/issues/54)).
- [x] LLM-as-a-Judge position-debiasing and trajectory metrics in `@nestjs-agentic/evaluation` ([#55](https://github.com/irzix/nestjs-agentic/issues/55)).

---

### 0.9 — Njent: Autonomous Code Review & PR Governance Agent

> **Status: Complete** | [Milestone 0.9](https://github.com/irzix/nestjs-agentic/milestone/5)

Goal: deliver the flagship production reference agent unifying all 8 ecosystem packages into an enterprise-grade GitHub PR review bot ([Epic #61](https://github.com/irzix/nestjs-agentic/issues/61)).

- [x] AST Codebase indexing and GraphRAG dependency graph for target repositories (`@nestjs-agentic/rag`).
- [x] U-Curve context formatting and FrugalGPT model cascading for cost-effective review rounds (`@nestjs-agentic/core`).
- [x] Stanford Tri-Factor cognitive memory and procedural review SOPs (`@nestjs-agentic/memory`).
- [x] Multi-agent specialized reviewers (Security, Quality & Performance, NestJS Architecture) with bounded concurrency (`@nestjs-agentic/orchestration`).
- [x] Variance-based consensus scoring across independent evaluator agents (labeled "Fleiss' Kappa" in Njent's own logs, though the underlying calculation is normalized variance, not categorical inter-rater Kappa).
- [x] Position-debiased quality evaluation for review comments before publishing (`@nestjs-agentic/evaluation`).
- [x] Human-in-the-loop (HITL) approval policy for autonomous code fixes and PR modifications (`@nestjs-agentic/core`).

---

### 1.0 — Production Release (General Availability)

> **Status: Complete (v1.0.0 GA Released)** | [Milestone 1.0](https://github.com/irzix/nestjs-agentic/milestone/6)

Goal: frozen public APIs, zero breaking changes guarantee, multi-tenant enterprise reliability, and proven performance across all 14 architectural pillars.

- [x] Stable public API contracts across all 8 ecosystem packages.
- [x] Full Fumadocs MDX documentation site deployed on Next.js 16 with interactive Mermaid diagrams.
- [x] Multi-stage containerized Docker builds and production deployment guides.
- [x] 100% pass rate across unit, integration, and E2E review agent workflows.

---

## 🔮 Forward Roadmap (v1.x & v2.0)

### 1.1 — Governance Correctness

> **Status: Planned** | [Milestone 1.1](https://github.com/irzix/nestjs-agentic/milestone/6)

Goal: close governance-boundary gaps found in a post-GA audit of the v1.0.0 codebase against its own documented guarantees, and bring documentation back in line with what actually ships.

- [x] Run Output Rails (`SecretRedactionPolicy`, `CanaryDetectionPolicy`, custom policies) on the approved-tool resume path, which bypasses them today ([#125](https://github.com/irzix/nestjs-agentic/issues/125)).
- [x] Scope `IdempotencyStore` keys by tenant, matching `SessionStore`'s existing tenant isolation ([#126](https://github.com/irzix/nestjs-agentic/issues/126)).
- [x] Run Output Rails against tool error messages, not just successful results, so failure payloads aren't exempt from secret/PII scrubbing ([#127](https://github.com/irzix/nestjs-agentic/issues/127)).
- [x] Correct fabricated class names and unimplemented RRF/BM25/Fleiss'-Kappa claims across `docs/ARCHITECTURE.md` and the documentation site ([#128](https://github.com/irzix/nestjs-agentic/issues/128)).
- [x] Populate `RAGContext.scores` during retrieval, unblocking rank-aware fusion strategies ([#129](https://github.com/irzix/nestjs-agentic/issues/129)).

### 1.2 — Retrieval Quality

> **Status: Planned** | [Milestone 1.2](https://github.com/irzix/nestjs-agentic/milestone/7)

Goal: bring `@nestjs-agentic/rag`'s retrieval and reranking up to what its own documentation has claimed since GA.

- [x] Implement real Reciprocal Rank Fusion (RRF) for combining dense and sparse result lists ([#130](https://github.com/irzix/nestjs-agentic/issues/130)).
- [x] Replace `HybridVectorStore`'s term-frequency-only sparse score with real BM25 (IDF, k1/b saturation) ([#131](https://github.com/irzix/nestjs-agentic/issues/131)).
- [x] Ship built-in reranker provider adapters (Cohere, Voyage) and a `minScore` cutoff ([#132](https://github.com/irzix/nestjs-agentic/issues/132)).
- [ ] Add an MMR (Maximal Marginal Relevance) diversity strategy to reduce near-duplicate chunks in context ([#133](https://github.com/irzix/nestjs-agentic/issues/133)).
- [x] Fix `HybridVectorStore.addChunks` to embed via batched `embedDocuments` instead of one `embedQuery` call per chunk ([#134](https://github.com/irzix/nestjs-agentic/issues/134)).
- [ ] Add an embedding cache (in-memory LRU, pluggable Redis backend) wrapping any `EmbeddingProvider` ([#134](https://github.com/irzix/nestjs-agentic/issues/134)).

### 1.3 — Security Hardening

> **Status: Planned** | [Milestone 1.3](https://github.com/irzix/nestjs-agentic/milestone/8)

Goal: extend Tri-Rail Guardrails beyond opt-in per-tool policies into deny-by-default governance, and close indirect-injection, PII, and audit-integrity gaps.

- [ ] Support module-level default policy chains so tools are governed even without explicit `@UsePolicies` ([#135](https://github.com/irzix/nestjs-agentic/issues/135)).
- [ ] Promote the example-only prompt-injection sanitizer into `@nestjs-agentic/core` and apply boundary-wrapping to retrieved RAG content ([#136](https://github.com/irzix/nestjs-agentic/issues/136)).
- [ ] Add provenance/taint labeling so policies can distinguish model, tool, and externally-sourced content ([#137](https://github.com/irzix/nestjs-agentic/issues/137)).
- [ ] Ship a `PiiRedactionPolicy` covering email, phone, credit card, and national ID patterns ([#138](https://github.com/irzix/nestjs-agentic/issues/138)).
- [ ] Add approver authorization/separation-of-duties checks on `ApprovalService` and a tamper-evident (hash-chained) audit sink ([#139](https://github.com/irzix/nestjs-agentic/issues/139)).

### 1.4 — Reliability & Output Quality

> **Status: Planned** | [Milestone 1.4](https://github.com/irzix/nestjs-agentic/milestone/9)

Goal: production-hardening primitives for the model-call boundary and quantitative retrieval evaluation.

- [ ] Support structured output with JSON Schema validation and bounded repair retries ([#140](https://github.com/irzix/nestjs-agentic/issues/140)).
- [ ] Add framework-level retry with backoff/jitter and a circuit breaker for model calls, independent of adapter-specific SDK retry behavior ([#141](https://github.com/irzix/nestjs-agentic/issues/141)).
- [x] Fix `RateLimitPolicy`'s unbounded in-process history growth by evicting fully-expired entries ([#142](https://github.com/irzix/nestjs-agentic/issues/142)).
- [ ] Replace `RateLimitPolicy`'s in-process static state with a distributed (Redis-backed) implementation ([#142](https://github.com/irzix/nestjs-agentic/issues/142)).
- [ ] Add retrieval-quality metrics (recall@k, precision@k, MRR, nDCG, faithfulness) to `@nestjs-agentic/evaluation` ([#143](https://github.com/irzix/nestjs-agentic/issues/143)).

### 1.5 — Dynamic Agent Tooling & Multi-Modal Perception

> **Status: In Progress**

Goal: empower agents with real-time multi-modal perception and zero-code runtime API ingestion.

- [ ] **Multi-Modal Model Adapters**: Native support for image, audio, and PDF perception inputs across OpenAI, Anthropic, and Gemini adapters (`@nestjs-agentic/core`, `@nestjs-agentic/openai`).
- [ ] **Dynamic OpenAPI & OpenRPC Ingestion**: Automatically generate governed NestJS `@Tool` schemas from external REST/OpenAPI specs at runtime without restarting processes.
- [ ] **Real-Time Event Transports**: Redis Streams and Apache Kafka event-driven adapters for asynchronous agent messaging and distributed pub/sub triggers.
- [ ] **Semantic Caching Engine**: Vector-similarity response caching for high-throughput, low-latency repetitive agent queries (`@nestjs-agentic/core`).

---

### 1.6 — Distributed Agent Swarms & Consensus Staking

> **Status: Planned**

Goal: scale multi-agent collectives across distributed cluster nodes with robust Byzantine fault tolerance.

- [ ] **Distributed Agent Runner**: Cluster-aware agent task scheduling across horizontal NestJS pods with automatic worker failover.
- [ ] **Reputation-Weighted Consensus**: Advanced consensus engines supporting stakeholder reputation weights and multi-round Delphi deliberation.
- [ ] **Continuous Episodic Distillation**: Automated background workers that analyze production trajectories and optimize agent prompt instructions periodically.

---

### 2.0 — Edge Micro-Runtimes & Decentralized MCP Federations

> **Status: Research & Exploration**

Goal: bring governed agent intelligence to serverless edge workers and decentralized tool networks.

- [ ] **Zero-Dependency Edge Runtimes**: Ultralight execution engine compatible with Cloudflare Workers, Fastly Compute, and Vercel Edge.
- [ ] **Decentralized MCP Mesh**: Discover, authenticate, and route tool invocations across peer-to-peer federated MCP servers with cryptographic capability tokens.
- [ ] **WebAssembly Sandboxed Tool Execution**: Isolate third-party community tool plugins in secure, WASM-sandboxed micro-containers.
