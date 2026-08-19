# Architecture Guide

This document describes the production architecture of **nestjs-agentic** (v1.0.0 GA), the security boundaries that govern tool executions, durable state persistence, and the decoupled multi-package ecosystem.

---

## 🏛️ Architectural Position

`nestjs-agentic` is an enterprise runtime and governance layer for building autonomous, governed AI agents natively in NestJS.

Unlike external scripting libraries or rigid graph frameworks, `nestjs-agentic` operates entirely inside the NestJS Dependency Injection (DI) and lifecycle container:
1. **NestJS-Native Providers**: Agents and ToolSets are standard `@Injectable()` services that inject database repositories, HTTP clients, caches, and microservice clients.
2. **Context-Bound Tool Closures**: Tools never execute raw or unverified. Application security context (`tenantId`, `userId`, `roles`, `permissions`) is bound directly to tool execution closures.
3. **Policy-Gated Execution**: Policies (`allow`, `deny`, `require_approval`) intercept every model intent before side effects occur.
4. **Vendor-Neutral Decoupling**: Models and external transports are pluggable adapters (`ModelAdapter`, `McpClientTransport`). Core execution logic remains independent of proprietary SDKs.

---

## 📦 Package Ecosystem & Boundaries

The ecosystem is decomposed into seven modular runtime packages plus one umbrella meta-package:

```text
Application Services & Modules
    │
    ▼
nestjs-agentic (Meta Package)
    │
    ├── @nestjs-agentic/core
    │     Agents, Tools, Policies, HITL Approvals, Checkpoints, Limits, Tracing
    │
    ├── @nestjs-agentic/openai
    │     ModelAdapter for OpenAI, Azure, Ollama, Groq, vLLM, OpenRouter
    │
    ├── @nestjs-agentic/memory
    │     ShortTerm, Working Scratchpad, Semantic Vector, Episodic Tri-Factor
    │
    ├── @nestjs-agentic/rag
    │     AST Code Chunking, HybridVectorStore, GraphRAG, Cross-Encoders
    │
    ├── @nestjs-agentic/orchestration
    │     Parallel Fan-Out (Bounded Concurrency), Refinement Loops, Debate Consensus
    │
    ├── @nestjs-agentic/evaluation
    │     Debiased Pairwise Judge, BenchmarkRunner, Trajectory Scoring
    │
    └── @nestjs-agentic/mcp
          Model Context Protocol (Stdio / SSE Client Transports, Tool Discovery)
```

| Package | Responsibility | Primary Primitives |
| :--- | :--- | :--- |
| **`@nestjs-agentic/core`** | Agent lifecycle, DI discovery, tool policy governance, execution limits, state stores, and OpenTelemetry tracing. | `@Agent`, `@ToolSet`, `@Tool`, `@Param`, `@Context`, `@UsePolicies`, `AgenticModule`, `ApprovalService`, `ExecutionLimits` |
| **`@nestjs-agentic/openai`** | Model adapter for OpenAI and compatible Chat Completions endpoints with streaming and token tracking. | `OpenAiModelAdapter`, `ModelAdapter`, `ModelResponseChunk` |
| **`@nestjs-agentic/memory`** | 5-tier cognitive memory architecture with Stanford tri-factor retrieval scoring. | `ShortTermMemory`, `ScratchpadMemory`, `SemanticMemory`, `EpisodicMemory`, `CompositeMemoryStore` |
| **`@nestjs-agentic/rag`** | Context engineering engine with AST hierarchical chunking, hybrid BM25 + vector search, GraphRAG, and cross-encoders. | `KnowledgeBase`, `HybridVectorStore`, `AstCodeChunker`, `GraphRAGStrategy`, `CrossEncoderReranker` |
| **`@nestjs-agentic/orchestration`** | Multi-agent delegation, parallel fan-out runners, supervisor refinement loops, and multi-agent debate consensus. | `ParallelSubAgentRunner`, `RefinementLoopRunner`, `DebateRoundRunner`, `ConsensusEngine` |
| **`@nestjs-agentic/evaluation`** | Benchmarking suite with position-debiased pairwise LLM judges and CI/CD quality regression gates. | `DebiasedPairwiseJudge`, `BenchmarkRunner`, `TrajectoryScorer` |
| **`@nestjs-agentic/mcp`** | Model Context Protocol integration providing standardized client transports and dynamic tool providers. | `McpClientTransport`, `McpToolProvider`, `StdioTransport`, `SseTransport` |
| **`nestjs-agentic`** | Umbrella meta-package providing streamlined exports and zero-configuration developer ergonomics. | Re-exports all core primitives |

---

## ⚡ Execution Lifecycle & Cognitive Loop

```mermaid
flowchart TD
    REQ[Application Request] --> RUNNER[AgentRunner]
    RUNNER --> RESOLVE[Resolve AgentProvider & AgentConfig via DI]
    RESOLVE --> CTX[Create AgentContext with Security & Session Metadata]
    CTX --> TOOLS[LocalToolProvider builds ResolvedTool Closures]
    TOOLS --> EXEC[AgentExecutor Cognitive Loop]
    EXEC --> MODEL[ModelAdapter.generate or stream]
    MODEL --> DECIDE{Model requested tool calls?}
    DECIDE -->|No| DONE[Return Final AgentResult]
    DECIDE -->|Yes| VALIDATE[Validate Arguments against ToolParamSchema]
    VALIDATE -->|Invalid| FEEDBACK[Inject Schema Validation Error to Model]
    VALIDATE -->|Valid| TOOL[ResolvedTool.execute]
    TOOL --> POLICY{Policy Evaluation}
    POLICY -->|Allow| METHOD[Invoke NestJS Provider Method]
    POLICY -->|Deny| DENIED[Return Denied Result to Model]
    POLICY -->|Require Approval| SUSPEND[Save Versioned Checkpoint & Suspend Turn]
    METHOD --> FEEDBACK
    DENIED --> FEEDBACK
    FEEDBACK --> BUDGET{Check ExecutionLimits}
    BUDGET -->|Exceeded| TERMINATE[Throw BudgetExceededError]
    BUDGET -->|Within Limits| MODEL
```

---

## 🛡️ Governed Tool Boundary (`ResolvedTool`)

A `ResolvedTool` is the core security boundary between model-driven actions and application side effects.

```text
ResolvedTool.execute({ args, toolCallId })
    │
    ├── 1. Evaluate Attached Policies (@UsePolicies)
    │     ├── Evaluate with AgentContext, tool name, arguments, and metadata
    │     │
    │     ├── DENY ──► Return { success: false, status: 'denied', reason }
    │     │
    │     └── REQUIRE_APPROVAL ──►
    │           Save serializable PendingApproval with versioned ApprovalCheckpoint
    │           Return { success: false, status: 'pending_approval', approvalId, reason }
    │
    └── 2. ALLOW (Permitted Execution)
          Map validated parameters to method signature
          Inject AgentContext into parameter decorated with @Context()
          Execute NestJS provider method inside application DI scope
          Sanitize output via Tri-Rail guardrails
          Return { success: true, data }
```

### Key Security Invariants:
1. **No Raw References**: Models and external runtimes never receive raw references to NestJS provider instances or database connections.
2. **Deterministic Context**: Application context (`tenantId`, `userId`, `roles`) is injected by the framework and cannot be spoofed or overridden by the LLM.
3. **Idempotency Safeguards**: Sensitive side effects utilize `IdempotencyPolicy` backed by `RedisIdempotencyStore` or `PostgresIdempotencyStore` to prevent duplicate operations during retries.

---

## 👥 Human-in-the-Loop (HITL) & Durable Turn Resumption

```mermaid
sequenceDiagram
    participant Model as LLM / ModelAdapter
    participant Executor as AgentExecutor
    participant Tool as ResolvedTool
    participant Store as ApprovalStore (Postgres/Redis)
    participant Human as Human Operator
    participant Service as ApprovalService

    Model->>Executor: Tool call intent (e.g. transferFunds)
    Executor->>Tool: execute(args, toolCallId)
    Tool->>Store: save PendingApproval + versioned ApprovalCheckpoint
    Tool-->>Executor: pending_approval + approvalId
    Executor-->>Service: Turn suspended gracefully

    Note over Human,Service: Out-of-band asynchronous decision

    Human->>Service: approve(approvalId, actor) or reject(approvalId, actor)
    Service->>Store: claim(approvalId) [Atomic claim-and-lock]
    Service->>Tool: Execute permitted method via DI
    Service->>Executor: resume(checkpoint, toolCallId, outcome)
    Executor->>Model: Feed approval outcome into conversation transcript
    Model-->>Executor: Model continues reasoning to final completion
```

### Checkpoint & Resumption Invariants:
* **Atomic Claim-and-Lock**: `ApprovalStore.claim()` atomically claims pending approvals before execution, guaranteeing at-most-once settlement even under concurrent webhook retries.
* **Process-Agnostic Resumption**: The `ApprovalCheckpoint` contains the complete serialized transcript, allowing a different worker node in a cluster to resume the turn seamlessly.
* **Audit Trail Integration**: All terminal approval events (approved, rejected, expired, failed) are broadcast to configured `AuditSink` listeners.

---

## 🧠 Cognitive Memory Architecture (`@nestjs-agentic/memory`)

`@nestjs-agentic/memory` provides a 5-tier hierarchical cognitive memory system:

1. **Short-Term Session Memory (`ShortTermMemory`)**: In-memory and Redis-backed sliding window conversation transcripts.
2. **Epistemic Working Scratchpad (`ScratchpadMemory`)**: Structured scratchpad for interim reasoning, task decomposition, and hypothesis testing.
3. **Semantic Vector Memory (`SemanticMemory`)**: Embeddings-based similarity recall for domain facts and unstructured reference documents.
4. **Episodic Experiential Memory (`EpisodicMemory`)**: Stores historical execution episodes scored using the **Stanford Tri-Factor Formula**:
   $$\text{Score} = (w_{\text{recency}} \cdot S_{\text{recency}}) + (w_{\text{importance}} \cdot S_{\text{importance}}) + (w_{\text{relevance}} \cdot S_{\text{relevance}})$$
5. **Composite Memory Aggregation (`CompositeMemoryStore`)**: Unified interface orchestrating retrieval across all active tiers.

---

## 🔍 Context Engineering & GraphRAG (`@nestjs-agentic/rag`)

`@nestjs-agentic/rag` solves the *Lost in the Middle* phenomenon and contextual fragmentation:

* **AST Hierarchical Code Splitting (`AstCodeChunker`)**: Parses source code into semantic AST blocks (classes, methods, interfaces) with full scope and import metadata.
* **Hybrid Retrieval (`HybridVectorStore`)**: Combines dense semantic vector embeddings with sparse BM25 keyword matching using Reciprocal Rank Fusion (RRF).
* **Relational Traversal (`GraphRAGStrategy`)**: Traverses entity-relationship graphs (imports, callers, inheritance) to retrieve deep dependency subgraphs.
* **Cross-Encoder Reranking (`CrossEncoderReranker`)**: Re-scores top candidates using cross-attention models before final prompt formatting.

---

## 🎭 Multi-Agent Orchestration (`@nestjs-agentic/orchestration`)

`@nestjs-agentic/orchestration` coordinates parallel, distributed, and iterative agent workflows:

* **Parallel Fan-Out (`ParallelSubAgentRunner`)**: Executes multiple specialist agents concurrently with bounded resource limits (`maxConcurrency`) and unified `AbortSignal` cancellation propagation.
* **Supervisor Refinement Loops (`RefinementLoopRunner`)**: Iterative review-and-correct loops where a supervisor critiques and refines draft outputs until acceptance criteria or iteration limits are met.
* **Multi-Agent Debate & Consensus (`DebateRoundRunner`, `ConsensusEngine`)**: Facilitates multi-round dialectic debates among competing agents, measuring convergence via **Fleiss' Kappa inter-rater reliability**:
  $$\kappa = \frac{\bar{P} - \bar{P}_e}{1 - \bar{P}_e}$$

---

## 📊 Evaluation & Quality Benchmarking (`@nestjs-agentic/evaluation`)

`@nestjs-agentic/evaluation` provides automated quality gates for CI/CD pipelines:

* **Position-Debiased Pairwise Judge (`DebiasedPairwiseJudge`)**: Runs bidirectional pairwise evaluations $(A \text{ vs } B \text{ and } B \text{ vs } A)$ to eliminate position and verbosity bias.
* **Trajectory Scorer (`TrajectoryScorer`)**: Evaluates agent decision paths based on token efficiency, tool-calling precision, and policy compliance.
* **Automated Benchmark Runner (`BenchmarkRunner`)**: Executes structured test suites with pass/fail regression thresholds.

---

## 🔌 Model Context Protocol (`@nestjs-agentic/mcp`)

`@nestjs-agentic/mcp` connects NestJS agents to standardized MCP tool ecosystems:

* **Stdio Client Transport (`StdioTransport`)**: Spawns local CLI-based MCP server subprocesses with bidirectional JSON-RPC 2.0 communication.
* **SSE Client Transport (`SseTransport`)**: Connects to remote HTTP Server-Sent Events (SSE) MCP endpoints with automatic reconnects and heartbeat monitoring.
* **Dynamic Discovery (`McpToolProvider`)**: Automatically queries remote MCP servers for tool schemas and registers them as governed NestJS `ResolvedTool` instances.

---

## 📐 Design Principles

1. **NestJS-Native DI First**: Framework primitives integrate seamlessly with standard NestJS lifecycle hooks (`OnModuleInit`, `OnModuleDestroy`) and dependency injection.
2. **Explicit Governance Over Open Autonomy**: Every tool execution must pass through policy evaluation; models cannot bypass security boundaries.
3. **Deterministic Application Context**: User identities, tenant boundaries, and access roles are managed by application services, never inferred by LLMs.
4. **Zero Vendor Lock-In**: Decoupled contracts allow switching between OpenAI, Anthropic, Gemini, Ollama, and local models with zero application code changes.
5. **Production Durability by Default**: State stores, execution checkpoints, and idempotency guarantees ensure enterprise reliability in multi-instance cluster deployments.
