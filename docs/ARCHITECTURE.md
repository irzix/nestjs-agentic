# Architecture Guide

This document describes the current architecture of **nestjs-agentic**, the boundaries that protect tool execution, and the direction of the independent runtime planned in the [product roadmap](ROADMAP.md).

## Architectural Position

nestjs-agentic is a NestJS-native runtime and governance layer for bounded AI agents. Application services remain ordinary NestJS providers. The framework discovers selected methods as tools, binds application-owned context to them, and enforces policies before a runtime can invoke their side effects.

The core package does not require a specific model provider or graph framework.

## Package Boundaries

```text
Application
    |
    +-- @nestjs-agentic/core
    |     agents, tools, policies, approvals, stores, AgentRunner
    |
    +-- model adapter for the built-in runtime
    |     @nestjs-agentic/openai
    |     custom ModelAdapter
    |
    +-- or an external runtime adapter
    |     @nestjs-agentic/adk
    |     @nestjs-agentic/langgraph
    |     custom RuntimeAdapter
    |
    +-- optional capability packages
          memory, experience, rag, orchestration, evaluation
```

| Package area | Responsibility |
| --- | --- |
| `core` | NestJS registration, metadata discovery, agent context, governed tools, the built-in agent runtime, model and runtime contracts, approvals, and store contracts. |
| Runtime adapters | Translate the framework runtime input to a provider or compatibility SDK. Current adapters are experimental and may not provide identical behavior. |
| `memory`, `experience`, `rag` | Opt-in cognitive and retrieval primitives. They are not automatically attached to `AgentRunner`. |
| `orchestration` | Opt-in delegation, parallel execution, fallback, and refinement built on `AgentRunner`. It is not currently a durable graph engine. |
| `evaluation` | Opt-in metrics, benchmark execution, and reporting. |

## Current Execution Path

```mermaid
flowchart TD
    REQUEST[Application request] --> RUNNER[AgentRunner]
    RUNNER --> AGENT[Resolve AgentProvider and AgentConfig]
    AGENT --> CONTEXT[Create AgentContext]
    CONTEXT --> TOOLS[LocalToolProvider builds ResolvedTools]
    TOOLS --> ADAPTER[AgentExecutor, or RuntimeAdapter when no ModelAdapter is registered]
    ADAPTER --> INVOKE[Runtime invokes ResolvedTool.execute]
    INVOKE --> POLICIES[Evaluate tool policies]
    POLICIES -->|allow| METHOD[Invoke NestJS provider method]
    POLICIES -->|deny| DENIED[Return denied result]
    POLICIES -->|require approval| PENDING[Store PendingApproval]
    METHOD --> RESULT[Return tool result to runtime]
    DENIED --> RESULT
    PENDING --> RESULT
```

`AgentRunner` performs the following work for each run:

1. Resolves the registered agent by name.
2. Reads its instructions, tools, and model configuration.
3. Creates an `AgentContext` containing the session, trace, security, and application data.
4. Asks `LocalToolProvider` to convert decorated NestJS methods into `ResolvedTool` closures.
5. Passes the message, tools, instructions, and model configuration to the selected `RuntimeAdapter`.

The runtime never receives raw access to NestJS tool instances or the application security context. It receives callable `ResolvedTool` objects.

## Governed Tool Boundary

A `ResolvedTool` is the main security boundary between model-driven decisions and application side effects:

```text
ResolvedTool.execute({ args })
    |
    +-- resolve configured policies
    +-- evaluate policies with AgentContext, tool name, and arguments
    |
    +-- deny
    |     return { success: false, status: 'denied', reason }
    |
    +-- require_approval
    |     save PendingApproval
    |     return { success: false, status: 'pending_approval', approvalId, reason }
    |
    +-- allow
          map arguments to the decorated method
          inject AgentContext into @Context parameter
          invoke the NestJS provider method
          return { success: true, data }
```

This design keeps policy enforcement independent of model and runtime adapters. A compliant adapter invokes the provided closure instead of calling application services directly.

## Human-in-the-Loop: Current Behavior

```mermaid
sequenceDiagram
    participant Runtime
    participant Tool as ResolvedTool
    participant Policy
    participant Store as ApprovalStore
    participant Human
    participant Service as ApprovalService

    Runtime->>Tool: execute(args)
    Tool->>Policy: evaluate(context, toolName, args)
    Policy-->>Tool: require_approval
    Tool->>Store: save PendingApproval with execute closure
    Tool-->>Runtime: pending_approval + approvalId
    Human->>Service: approve(approvalId)
    Service->>Store: get(approvalId)
    Service->>Service: invoke stored closure
    Service->>Store: delete(approvalId)
```

The current approval API protects an individual tool invocation, but it is not yet a durable workflow pause:

- continuation is stored as a process-local JavaScript closure;
- a process restart cannot reconstruct that closure;
- the built-in runtime suspends the turn and returns the `approvalId`, but approving it executes only the pending tool and does not resume the model loop;
- durable checkpoint and exactly-once behavior are roadmap work.

Applications should treat the current HITL implementation as experimental when restart recovery or multi-instance execution is required.

## Built-in Agent Runtime

When the application registers a `ModelAdapter`, `AgentRunner` executes the turn through the framework-owned `AgentExecutor` instead of handing the whole turn to a runtime adapter:

```mermaid
flowchart TD
    RUNNER[AgentRunner] --> EXEC[AgentExecutor]
    EXEC --> MODEL[ModelAdapter.generate or stream]
    MODEL --> DECIDE{Tool calls requested?}
    DECIDE -->|no| DONE[Return final answer]
    DECIDE -->|yes| VALIDATE[Validate args against ToolParamSchema]
    VALIDATE -->|invalid| FEEDBACK[Report error to the model]
    VALIDATE -->|valid| TOOL[ResolvedTool.execute]
    TOOL --> POLICY[Policy decision]
    POLICY -->|allow or deny| FEEDBACK
    POLICY -->|require approval| SUSPEND[Suspend turn with approvalId]
    FEEDBACK --> BUDGET[Check iteration, tool-call, token, time budgets]
    BUDGET --> MODEL
```

The executor owns the behavior that every agent framework needs:

- iteration over model rounds until a final answer;
- argument validation, which drops undeclared keys and rejects incomplete calls before an application method runs;
- governed tool invocation through `ResolvedTool.execute()`;
- reporting a thrown tool error back to the model so the turn can recover, while framework configuration errors stay fatal;
- suspension when a policy requires approval;
- bounded execution via `ExecutionLimits` and an `AbortSignal`;
- token and tool lifecycle streaming through the shared `AgentStreamEvent` union.

A `ModelAdapter` only talks to a provider. It does not execute tools, evaluate policies, or manage the loop:

```typescript
interface ModelAdapter {
  generate(request: ModelRequest): Promise<ModelResponse>;
  stream?(request: ModelRequest): AsyncIterable<ModelStreamChunk>;
}
```

`MockModelAdapter` ships with core so agents, policies, and the loop can be tested deterministically without a provider. `@nestjs-agentic/openai` implements the contract for OpenAI and Chat Completions compatible endpoints.

Both are verified by `runModelAdapterContract()`, the exported behavioral suite that any adapter, including a third-party one, can run to prove it satisfies the same guarantees.

## Runtime Adapter Boundary

The original delegation contract remains supported for applications that bring an entire external runtime:

```typescript
interface RuntimeAdapter {
  execute(input: AgentRunInput): Promise<AgentResult>;
  stream?(input: AgentRunInput): AsyncIterable<AgentStreamEvent>;
}
```

`AgentRunner` prefers the built-in runtime when a `ModelAdapter` is registered and otherwise uses the registered `RuntimeAdapter`, so existing applications keep working unchanged. This contract does not standardize model messages, tool-call rounds, usage, cancellation, or provider errors, so adapters written against it can differ in behavior.

- `MockRuntimeAdapter` supports deterministic framework tests.
- `AdkRuntimeAdapter` is an experimental synthetic runtime prototype published under `@nestjs-agentic/adk`; it does not currently integrate with provider-native ADK APIs.
- `LangGraphRuntimeAdapter` supports LangChain model and LangGraph checkpointer types, but does not currently compile or execute a LangGraph `StateGraph`.

The independent runtime milestone will move common model and tool-loop behavior behind framework-owned contracts while keeping provider integrations optional.

## Streaming: Current Behavior

`AgentRunner.runStream()` exposes `AgentStreamEvent` values.

With the built-in runtime, events follow a defined order per round: model tokens, then `tool_start`, then exactly one of `tool_result`, `approval_required`, or `tool_error`, and finally `complete`. Adapters that implement `ModelAdapter.stream()` produce incremental tokens; those that only implement `generate()` emit the round content as a single token event.

When execution is delegated to a `RuntimeAdapter`, event behavior depends on that adapter. If it does not implement `stream()`, the runner converts the completed `AgentResult` into tool and completion events. Failures that end a run, such as an exhausted budget or cancellation, still propagate as thrown errors rather than stream events.

## State, Sessions, and Memory

These concepts exist today but do not yet form one execution lifecycle:

| Concept | Current role |
| --- | --- |
| `SessionStore` | Conversation history for the built-in runtime, keyed by tenant and session, with an in-memory default. |
| `StateStore` | General state abstraction with in-memory and Redis implementations. It can be registered through `AgenticModule`. |
| Runtime checkpointer | Adapter-specific checkpoint facility, currently separate from core stores. |
| Memory packages | Explicitly constructed short-term, semantic, episodic, and scratchpad memory primitives. |

`AgentRunner` persists conversation history through `SessionStore` so turns on the same session continue each other. It does not yet persist or recover an in-flight execution, so a process restart still loses a suspended turn. The durable execution milestone covers checkpoints, resumable approval, and audit events.

## Orchestration: Current Behavior

`@nestjs-agentic/orchestration` calls `AgentRunner` to provide:

- sub-agent delegation;
- parallel fan-out;
- retries and fallback;
- iterative refinement.

The package is intentionally separate from core and has no direct LangGraph dependency. Its current implementation is process-local and does not yet provide durable scheduling, cancellation propagation, bounded concurrency, or retry-safe side-effect guarantees.

## Target Runtime Direction

```mermaid
flowchart LR
    APP[NestJS application] --> CORE[Agents, tools, policies]
    CORE --> ENGINE[Independent agent runtime]
    ENGINE --> MODEL[ModelAdapter]
    ENGINE --> EVENTS[Canonical events]
    ENGINE --> CHECKPOINT[CheckpointStore]
    ENGINE --> TOOL[Governed ResolvedTool]
    MODEL --> PROVIDERS[Provider adapters]
    CHECKPOINT --> STORES[Redis or PostgreSQL adapters]
    ENGINE --> OBSERVERS[Tracing and audit observers]
    ORCH[Reliable orchestration] --> ENGINE
```

The target runtime is responsible for common execution semantics:

- model-to-tool iteration;
- argument validation;
- streaming and execution events;
- cancellation, deadlines, and budgets;
- checkpoints and resumable approval;
- consistent errors, usage, and observability.

LangGraph, Google ADK, and direct model SDKs remain optional adapters. They do not define core agent, tool, governance, or persistence contracts.

## Design Rules

1. **Application services remain ordinary NestJS providers.** Tool decorators expose selected methods without moving business logic into the framework.
2. **Every framework-managed side effect crosses a governed tool closure.** Runtime adapters must not bypass `ResolvedTool.execute()`.
3. **Identity is application-owned.** Models do not create or override tenant, user, role, or permission data.
4. **Core types remain vendor-neutral.** Provider SDK types belong in optional adapter packages.
5. **Deterministic workflows surround model decisions.** Agents handle ambiguity inside explicit application boundaries.
6. **Reliability precedes additional autonomy.** Durable state, cancellation, idempotency, and observability are prerequisites for advanced orchestration.

See [ROADMAP.md](ROADMAP.md) for milestone scope and production-readiness criteria.
