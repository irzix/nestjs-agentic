# Product Roadmap

> **Product direction:** nestjs-agentic is the NestJS-native runtime for governed AI agents. It brings agents, tools, policy enforcement, human approval, execution state, and observability into the NestJS module and dependency-injection system.

The project is not intended to be a thin AI SDK wrapper or a clone of a general-purpose graph framework. Its focus is making agentic workloads safe, testable, observable, and operable inside NestJS applications.

## Status Definitions

| Status | Meaning |
| --- | --- |
| **Available** | Implemented and exposed through the public API. Breaking changes remain possible before 1.0. |
| **Experimental** | Available for evaluation and feedback, but missing one or more production guarantees. |
| **Planned** | Part of the accepted product direction, but not yet implemented. |

A published package is not automatically production-ready. The current status and limitations of each capability are documented below.

## Product Pillars

1. **NestJS-native development** — agents and tools work naturally with modules, dependency injection, decorators, and application testing.
2. **Governance by default** — every framework-managed tool call crosses a policy boundary before side effects are allowed.
3. **Bounded autonomy** — model decisions operate within explicit tools, permissions, time, cost, and iteration limits.
4. **Vendor-neutral execution** — application agents are not coupled to a specific model SDK or graph framework.
5. **Operational reliability** — production execution must be cancellable, durable, observable, and auditable.

## Where We Are Today

The current release line is `0.4.x`.

| Capability | Status | Current scope |
| --- | --- | --- |
| NestJS agents and tools | Available | Decorators, discovery, module registration, dependency injection, and context-bound tools. |
| Tool policies | Available | `allow`, `deny`, and `require_approval` decisions before framework-managed tool execution. |
| Mock runtime | Available | Deterministic agent and governance testing without external model calls. |
| Built-in agent runtime | Available | `AgentExecutor` runs the governed model-to-tool loop with argument validation, execution budgets, cancellation, and streaming. Requires an application-supplied `ModelAdapter`. |
| OpenAI model adapter | Available | `@nestjs-agentic/openai` covers OpenAI and Chat Completions compatible endpoints, including Azure, Ollama, vLLM, Groq, and OpenRouter. |
| Additional model adapters | Planned | Anthropic, Google, and Vercel AI SDK adapters will follow the same `ModelAdapter` contract. |
| Human approval | Experimental | Approval and rejection resume the original model turn and use a serializable `PendingApproval` record, so a durable `ApprovalStore` (e.g. `RedisApprovalStore`) can survive a process restart or resolve on a different instance. Settlement is atomic (at most once) via `ApprovalStore.claim()`, approvals can expire via a policy `ttlSeconds` or module `approvalTtlSeconds`, and each suspension carries a versioned `ApprovalCheckpoint` so resuming does not depend on `SessionStore` retention. Both approval stores are verified by the `runApprovalStoreContract` suite, and the policy boundary plus the full approval lifecycle — including the deciding actor — are recorded through `AuditSink`. Idempotency keys for retrying a claimed-but-failed tool, restart/recovery integration tests, and checkpointing turns that are still in flight remain open. |
| Legacy runtime adapters | Experimental | The ADK-named package is currently a synthetic runtime prototype. The LangGraph package provides limited LangChain and checkpointer compatibility, but full graph execution is not currently part of the adapter. |
| Conversation history | Available | The built-in runtime replays and persists per-session conversation through `SessionStore`, scoped by tenant, with retention that keeps tool exchanges intact. |
| Streaming and state | Experimental | Shared event and state abstractions exist, but adapter behavior and execution recovery are not yet unified. |
| Memory and experience | Experimental | Memory, summarization, reflection, and experience primitives are available as opt-in packages. |
| RAG | Experimental | Retrieval strategies, vector-store abstractions, and knowledge-graph primitives are available as opt-in packages. |
| Multi-agent orchestration | Experimental | Delegation, parallel execution, fallback, and refinement APIs are available; production reliability work remains. |
| Evaluation | Experimental | Metrics, benchmarks, and reporting are available; runtime trace integration and CI quality gates remain planned. |
| Governance audit trail | Experimental | Policy decisions and the full approval lifecycle, including the deciding actor, are recorded to any registered `AuditSink`. Argument capture is opt-in and redactable. Durable sink implementations are left to the application. |
| Observability: traces and metrics | Planned | Observer APIs exist, but end-to-end runtime wiring and OpenTelemetry-compatible traces and metrics for model and tool execution are not yet implemented. |
| Vercel AI SDK and MCP | Planned | These integrations will follow the common runtime and governance contracts. |

## Release History

| Release | Foundation introduced |
| --- | --- |
| `0.1` | NestJS agent and tool primitives, runtime boundary, policies, context isolation, approval APIs, and mock runtime. |
| `0.2` | State and streaming abstractions, policy utilities, memory primitives, and initial ADK and LangGraph packages. |
| `0.3` | RAG, vector and knowledge-graph abstractions, reflection, and experience primitives. |
| `0.4` | Sub-agent orchestration, refinement loops, evaluation metrics, benchmarks, and reporting. |

These releases established the framework surface. The next releases prioritize depth and behavioral consistency over adding more packages.

## Forward Roadmap

Version numbers are directional and may change as the contracts are validated.

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

**Exit criteria met:** a NestJS application can run, stream, cancel, and test a governed tool-calling agent without adopting a graph framework.

Migrating the ADK and LangGraph packages onto the common contracts was dropped from this milestone. Neither blocks the runtime, and the ADK package needs a naming decision before an implementation decision. Both moved to [Future Directions](#future-directions).

### 0.6 — Durable and Observable Execution

> **Status: Planned**

Goal: make executions safe to pause, recover, inspect, and operate in production environments.

- [x] Persist and replay conversation history per session, scoped by tenant.
- [ ] Introduce durable, versioned execution checkpoints and documented recovery behavior. (Approval suspensions now carry a versioned `ApprovalCheckpoint` with documented recovery and refusal behavior; checkpointing a turn that is still mid-round remains.)
- [x] Replace process-local approval continuation with resumable human-in-the-loop execution: `PendingApproval` is a serializable record, `RedisApprovalStore` supports durable storage, and resolving an approval resumes the suspended model turn instead of only returning the bare tool result.
- [ ] Add idempotency support and safe retry behavior for side-effecting tools. (Approval settlement is now atomic and at-most-once via `ApprovalStore.claim()`; idempotency keys for safely retrying a claimed-but-failed tool remain.)
- [ ] Propagate cancellation and deadlines through model, tool, and persistence operations.
- [ ] Add bounded concurrency and failure-aware retries.
- [ ] Provide production-intent Redis and/or PostgreSQL persistence adapters. (`RedisApprovalStore`, `RedisSessionStore`, and `RedisStateStore` exist; `RedisApprovalStore` and `RedisSessionStore` are covered by their contract test suites. PostgreSQL adapters remain.)
- [x] Publish a reusable behavioral contract-test suite for approval stores (`runApprovalStoreContract`).
- [x] Publish a reusable behavioral contract-test suite for session stores (`runSessionStoreContract`).
- [ ] Wire runtime observers and OpenTelemetry-compatible traces and metrics.
- [ ] Record auditable model, tool, policy, and approval events. (Policy decisions and the full approval lifecycle are recorded through `AuditSink`, including the deciding actor. Model and tool execution events remain.)
- [ ] Harden tenant and identity isolation throughout runtime execution.
- [ ] Cover restart, recovery, cancellation, and duplicate-execution scenarios with integration tests.

**Exit criteria:** an execution can pause for approval, survive a restart, resume safely, and be traced without duplicating completed side effects.

### 0.7 — Reliable Orchestration

> **Status: Planned**

Goal: build multi-agent coordination on the same guarantees as single-agent execution.

- [ ] Add cancellation-aware fan-out and bounded parallel execution.
- [ ] Implement true first-success, fallback, and evaluator-driven aggregation semantics.
- [ ] Make refinement loops budget-aware, checkpointed, and resumable.
- [ ] Preserve immutable identity and tenant context while allowing explicit capability narrowing.
- [ ] Support durable delegation and retry-safe fan-out/join behavior.
- [ ] Add workflow status, cancellation, resume, and inspection APIs.
- [ ] Apply the runtime contract suite to orchestration failure and recovery paths.

**Exit criteria:** orchestrated executions preserve cancellation, durability, idempotency, security, and observability guarantees across every sub-agent.

## Ecosystem Work

Integrations should follow the common contracts rather than define them. Work may proceed alongside the main milestones when it does not destabilize the runtime API:

- Vercel AI SDK adapter
- MCP tool provider and client transport
- Anthropic and Google model adapters
- OpenTelemetry and Langfuse integrations
- additional memory, vector, checkpoint, and audit stores
- examples for HTTP, SSE, WebSocket, queues, and scheduled jobs

## Future Directions

These are areas of interest, not committed release scope:

- deciding the future of the ADK-named package: a real Google ADK integration, a rename that matches what it does, or deprecation
- reworking the LangGraph package as a `ModelAdapter` over a LangChain model, rather than keeping a partial `RuntimeAdapter`
- typed graph and workflow definitions
- distributed execution workers
- visual execution inspection and replay
- advanced multi-agent planning and routing
- additional evaluation and optimization workflows

They will be prioritized only after the independent runtime and durable execution guarantees are proven and user demand is clear.

## Production-Readiness Standard

A capability should be described as production-ready only when all applicable guarantees are demonstrated:

- shared contract and integration tests
- cancellation, deadlines, and bounded retries
- durable state and documented recovery behavior
- idempotency guidance for side effects
- traces, metrics, and auditable decisions
- tenant and identity isolation
- compatibility and migration documentation

Until then, documentation should describe the capability as **Available** or **Experimental** rather than imply a production guarantee.

## Non-Goals

- Replacing NestJS services, queues, databases, or authorization systems.
- Requiring LangGraph or any other orchestration framework.
- Building unconstrained autonomous agents without budgets, policies, or operator control.
- Treating multi-agent execution as the default for deterministic application workflows.
- Adding a graph API solely to mirror another framework.

## Design Principles

1. **NestJS-native first** — core APIs must fit naturally into modules, dependency injection, and application testing.
2. **Governance is non-optional** — every framework-managed tool invocation crosses the policy boundary.
3. **Security context is application-owned** — models never author identity, tenant, role, or permission data.
4. **Runtime contracts are vendor-neutral** — provider and orchestration SDK types remain in optional adapters.
5. **Reliability before autonomy** — durability, cancellation, idempotency, and observability precede more complex agent behavior.
6. **Claims follow evidence** — documentation describes behavior supported by implementation and tests.
