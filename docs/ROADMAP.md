# Product Roadmap

This roadmap outlines the past releases, current development priorities, and future direction of `nestjs-agentic`.

---

## 📚 Architectural Foundations & Research References

`nestjs-agentic` is designed in alignment with peer-reviewed academic literature and production AI engineering standards:

* **ReAct Reasoning:** *Yao et al., Princeton & Google Brain (ICLR 2023)* ([arXiv:2210.03629](https://arxiv.org/abs/2210.03629))
* **Tool Calling & MCP:** *Schick et al., Meta AI (Toolformer, arXiv:2302.04761)* & *Anthropic MCP Standard*
* **Multi-Agent SOPs & Debate:** *Hong et al. (MetaGPT, ICLR 2024, arXiv:2308.00352)* & *Du et al., MIT (arXiv:2305.14325)*
* **Context Engineering & Lost in the Middle:** *Liu et al., Stanford & UC Berkeley (TACL 2024, arXiv:2307.03172)*
* **GraphRAG & Knowledge:** *Edge et al., Microsoft Research (arXiv:2404.16130)* & *Lewis et al. (NeurIPS 2020)*
* **Memory Architectures:** *Park et al., Stanford (Generative Agents, arXiv:2304.03442)* & *Shinn et al., MIT (Reflexion, NeurIPS 2023)*
* **Evaluation & Debiasing:** *Zheng et al., UC Berkeley LMSYS (MT-Bench, NeurIPS 2023, arXiv:2306.05685)*
* **Model Cascades:** *Chen et al., Stanford University (FrugalGPT, arXiv:2305.05176)*
* **Security & Tri-Rail Guardrails:** *Rebedea et al., NVIDIA (arXiv:2310.10501)* & *Greshake et al. (USENIX Security 2023)*

---

## Package Architecture Status

| Package | Status | Role |
|---|---|---|
| [`nestjs-agentic`](packages/core) | **Production-intent (v0.5)** | Independent governed agent runtime, model contracts, lifecycle, tool policies, streaming, approvals, and observability. |
| [`@nestjs-agentic/openai`](packages/model-openai) | **Production-intent (v0.5)** | OpenAI and ChatCompletions compatible provider adapter. |
| [`@nestjs-agentic/orchestration`](packages/orchestration) | **Experimental (v0.4)** | Sub-agent delegation, parallel execution, SOP state machines, and refinement loops. |
| [`@nestjs-agentic/memory`](packages/memory) | **Experimental (v0.2)** | Short-term, semantic, episodic, procedural, and scratchpad memory primitives. |
| [`@nestjs-agentic/rag`](packages/rag) | **Experimental (v0.2)** | AST chunking, vector stores, hybrid search, and GraphRAG primitives. |
| [`@nestjs-agentic/experience`](packages/experience) | **Experimental (v0.2)** | Stanford tri-factor scoring, reflection, and experience learning over memory. |
| [`@nestjs-agentic/evaluation`](packages/evaluation) | **Experimental (v0.2)** | LLM-as-a-Judge debiasing, trajectory metrics, and benchmark reporting. |
| [`@nestjs-agentic/mcp`](packages/mcp) | **Planned (v0.8)** | Native Model Context Protocol client transport and tool provider. |
| [`@nestjs-agentic/adk`](packages/runtime-adk) | **Deprecated Prototype** | Early experimental runtime prototype (to be deprecated). |
| [`@nestjs-agentic/langgraph`](packages/runtime-langgraph) | **Deprecated Prototype** | Early LangChain/LangGraph adapter (to be reworked as model adapter). |

---

## Forward Roadmap

Version numbers are directional and tracked via GitHub milestones.

### 0.5 — Independent Agent Runtime

> **Status: Complete**

Goal: run a complete, governed agent turn without requiring LangGraph or another orchestration framework.

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

> **Status: Planned** | [Milestone 0.7](https://github.com/irzix/nestjs-agentic/milestone/3)

Goal: build multi-agent coordination on the same guarantees as single-agent execution.

- [x] Cancellation-aware fan-out and bounded parallel execution (`maxConcurrency` in `ParallelSubAgentRunner`) ([#35](https://github.com/irzix/nestjs-agentic/issues/35)).
- [x] Implement MetaGPT Standard Operating Procedures (SOPs) and Multi-Agent Debate Consensus ([#53](https://github.com/irzix/nestjs-agentic/issues/53), [#36](https://github.com/irzix/nestjs-agentic/issues/36)).
- [x] Make refinement loops budget-aware, checkpointed, and resumable ([#37](https://github.com/irzix/nestjs-agentic/issues/37)).
- [x] Preserve tenant identity and support capability narrowing in sub-agent delegation ([#38](https://github.com/irzix/nestjs-agentic/issues/38)).
- [x] Resilient error recovery and evaluator-driven sub-agent selection.

---

### 0.8 — Ecosystem & Production Adapters

> **Status: Planned** | [Milestone 0.8](https://github.com/irzix/nestjs-agentic/milestone/4)

Goal: deliver production ecosystem adapters, GraphRAG, advanced memory, and cost optimization.

- [x] Dedicated `@nestjs-agentic/mcp` package for Model Context Protocol client transport ([#41](https://github.com/irzix/nestjs-agentic/issues/41)).
- [ ] AST-aware codebase chunking and GraphRAG dependency traversal in `@nestjs-agentic/rag` ([#51](https://github.com/irzix/nestjs-agentic/issues/51)).
- [ ] U-Shaped context assembler utility to mitigate Lost-in-the-Middle degradation ([#52](https://github.com/irzix/nestjs-agentic/issues/52)).
- [ ] Stanford tri-factor memory retrieval scoring and procedural memory stores ([#50](https://github.com/irzix/nestjs-agentic/issues/50)).
- [ ] FrugalGPT model cascading and confidence-threshold routing ([#54](https://github.com/irzix/nestjs-agentic/issues/54)).
- [ ] LLM-as-a-Judge position-debiasing and trajectory metrics in `@nestjs-agentic/evaluation` ([#55](https://github.com/irzix/nestjs-agentic/issues/55)).
- [ ] Anthropic Claude ModelAdapter ([#39](https://github.com/irzix/nestjs-agentic/issues/39)) & Google Gemini ModelAdapter ([#40](https://github.com/irzix/nestjs-agentic/issues/40)).

---

### 1.0 — Production Release (GA)

> **Status: Planned** | [Milestone 1.0](https://github.com/irzix/nestjs-agentic/milestone/5)

General availability: end-to-end multi-tenant enterprise reliability, crash recovery, and proven performance across all 14 pillars.
