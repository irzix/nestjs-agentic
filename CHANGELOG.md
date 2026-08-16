# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-08-16

### Added

- **Multi-Tenant Identity Preservation & Capability Narrowing (`@nestjs-agentic/orchestration`)**:
  - `CapabilityNarrowing`: Explicit capability restrictions for delegated sub-agents including tool whitelists (`allowedTools`), tool blacklists (`deniedTools`), least-privilege permission and role subsetting (`allowedPermissions`, `allowedRoles`), and execution limits (`limits`).
  - `CapabilityNarrowingPolicy`: Built-in governance policy enforcing delegated tool capability constraints at policy evaluation time.
  - `Tenant Isolation & Trace Hierarchy`: SubAgentDelegator enforces strict `tenantId` immutability and propagates OpenTelemetry distributed trace parentage (`parentTraceId`, `rootTraceId`).
  - `MaxDelegationDepthExceededError` & `CapabilityDeniedError`: Bounded recursion depth protection (`maxDelegationDepth: 3`) preventing runaway sub-agent delegation loops (#38).

## [0.6.0] - 2026-08-16

### Added

- **PostgreSQL Persistence Adapters (`@nestjs-agentic/core`)**:
  - `GenericPostgresClient`: Interface for SQL query execution across `pg.Pool`, `pg.Client`, TypeORM QueryRunner, Kysely, and Slonik.
  - `PostgresStateStore`: PostgreSQL-backed `StateStore` for key-value runtime state and in-flight checkpoints with TTL and pattern clearing.
  - `PostgresSessionStore`: PostgreSQL-backed `SessionStore` with upsert support (`ON CONFLICT (session_id) DO UPDATE`) and TTL.
  - `PostgresApprovalStore`: Atomic, exactly-once approval claiming via single-statement `DELETE ... RETURNING` with `Date` revival and expiry grace periods.
  - `PostgresIdempotencyStore`: Tool deduplication store in PostgreSQL with TTL support.
  - `validateSqlIdentifier` & `safeDeserialize`: SQL identifier injection protection and deep-cloning JSON deserializer.
- **Durable In-Flight Execution Checkpoints (`@nestjs-agentic/core`)**:
  - Versioned `InFlightCheckpoint` capturing turn progress, token budgets, and completed tool calls across multi-turn loops.
  - `AgentRunner.resumeCheckpoint` and `AgentRunner.recoverLatestCheckpoint` with `checkpointTtlSeconds` configuration.
- **Contract Test Suites**:
  - `runSessionStoreContract`, `runApprovalStoreContract`, and `runIdempotencyStoreContract` verifying store implementations against behavioral contracts.
- **Multi-Instance Crash Recovery & HITL Integration Tests (`@nestjs-agentic/core`)**:
  - `runCrashRecoveryHitlTests`: Comprehensive 7-scenario integration test suite verifying multi-instance process crash recovery, complete DI container restart, Redis & PostgreSQL persistence store resumption, atomic single-claim concurrency, in-flight checkpoint recovery, rejection handling, and multi-tenant isolation (#30).
- **Runtime Observers & OpenTelemetry Tracing (`@nestjs-agentic/core`)**:
  - `AgentObserver`: Lifecycle hook interface (`onAgentStart`, `onModelRequest`, `onModelResponse`, `onToolCall`, `onToolResult`, `onAgentEnd`, `onError`).
  - `ObserverNotifier`: Concurrent, error-isolated lifecycle event dispatcher using `Promise.allSettled` with sampling rate control (`samplingRate`).
  - `OpenTelemetryGenAiObserver`: Built-in CNCF GenAI Semantic Conventions (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*`, `gen_ai.agent.*`, `gen_ai.tool.*`, `gen_ai.parent_trace.id`, `gen_ai.root_trace.id`).
  - `StructuredLogObserver`: Built-in structured JSON logging observer for NestJS Logger, Winston, and Pino.
  - `InMemoryAgentObserver`: In-memory event collector with configurable `maxEvents` FIFO bounds for unit testing and local inspection.
  - Multi-provider wiring: `AgenticModule.forRoot({ observers: [...] })` and `AGENT_OBSERVERS` token support in `AgentRunner` and `AgentExecutor`.

## [0.4.0] - 2026-08-10

### Added

- **Multi-Agent Orchestration Package (`@nestjs-agentic/orchestration`)**:
  - `SubAgentDelegator`: Context propagation and security isolation for sub-agent delegation.
  - `ParallelSubAgentRunner`: Concurrent `Promise.all` fan-out runner with timeout protection, retries, fallback sub-agent recovery, and score-weighted consensus.
  - `RefinementLoopRunner`: Iterative supervisor-worker feedback loops with versioned sub-session memory (`parentSessionId:agentName:iter_N`) and satisfaction criteria.
- **Automated Agent Evaluation Package (`@nestjs-agentic/evaluation`)**:
  - `AccuracyGroundTruthMetric`: Mathematical accuracy scoring via Vector Cosine Similarity and Sørensen-Dice Token Similarity.
  - `ExecutionEfficiencyMetric`: Weighted multi-variable ratios (step count ratio, latency ratio, token consumption ratio).
  - `SafetyPolicyMetric`: Security policy adherence and forbidden tool call detection.
  - `TrajectoryInspectorMetric`: Verification of tool call sequences and argument schema assertions.
  - `LLMAsAJudgeMetric`: LLM judge evaluation.
  - `BenchmarkRunner`: Dataset suite benchmark runner with Multi-Trial Variance Analysis ($\mu$ mean score and $\sigma$ standard deviation).
  - `EvalReporter`: GitHub-Flavored Markdown benchmark report generator.
- **Monorepo-Wide TSDoc Audit**: Added comprehensive `/** ... */` TSDoc comments across all exported classes, interfaces, decorators, and policies in core, memory, experience, rag, orchestration, and evaluation packages.
- **CI/CD Pipeline**: Added `@nestjs-agentic/orchestration` and `@nestjs-agentic/evaluation` NPM publish steps in `.github/workflows/publish.yml`.

## [0.3.0] - 2026-08-10

### Added

- **Production-Grade RAG Package (`@nestjs-agentic/rag`)**:
  - `Document` & `DocumentChunk` Core Data Models.
  - `EmbeddingAdapters`: `OpenAIEmbeddingAdapter` (OpenAI & Ollama/vLLM local servers), `CustomEmbeddingAdapter` (REST endpoints), and `MockEmbeddingProvider`.
  - `DocumentSplitters`: `SemanticDocumentSplitter` (Markdown section parsing) and `ParentChildSplitter` (sliding window overlap & parent text metadata).
  - **7 Modular RAG Strategies**:
    - `QueryExpansionStrategy`: Custom dictionary synonym expansion + LLM sub-queries.
    - `HierarchicalRAGStrategy`: Markdown section node tree rollup and sibling aggregation.
    - `ParentChildHydrationStrategy`: Parent context hydration without raw text duplication.
    - `LateChunkingStrategy`: Blending global document vector context with chunk vectors.
    - `ContextualCompressionStrategy`: Zero-latency extractive sentence selection & boundary truncation.
    - `GraphRAGStrategy`: Sub-graph multi-hop entity traversal, fuzzy `searchNodes` matching, and Graph-Guided Chunk Score Boosting.
    - `RerankerStrategy`: Term frequency scoring + custom Cross-Encoder model (`rerankFn`) support.
  - **Graph & Vector Stores**:
    - `HybridVectorStore`: Parallel batch embedding, Min-Max score scaling, multi-tenant metadata filtering, `@nestjs-agentic/memory` compatibility.
    - `InMemoryKnowledgeGraphProvider`: Zero-dependency multi-hop entity relationship provider.
  - **RAG Engines**:
    - `KnowledgeBase`: Document ingestion, indexing, and filtered chunk querying.
    - `RAGPipeline`: Partitioned pre-retrieval & post-retrieval strategy execution.
- **Experience Learning & Trajectory Reflection (`@nestjs-agentic/experience`)**:
  - `ExperienceLearner`: Trajectory critique and lesson extraction engine for self-correcting prompt guidance.
  - `ReflectionEngine`: Automated evaluation of failed execution paths and policy violation feedback loops.
  - `ExperienceStore`: Persistent storage and retrieval of learned rules and historical trajectory lessons integrated with `@nestjs-agentic/memory`.
- **Comprehensive Unit & Integration Test Suites**:
  - Added 22 unit tests in `@nestjs-agentic/rag`.
  - Added Test 7 (Experience Reflexion & Learning) and Test 8 (all 7 RAG strategies) in `example-financial-governance`.

---

## [0.2.5] - 2026-08-10

### Added

- **Multi-tier Cognitive Memory Suite (`@nestjs-agentic/memory`)**:
  - `ShortTermMemory`: Sliding-window session conversation history with configurable `maxMessages` token capping and core `StateStore` integration.
  - `ScratchpadMemory`: Active working task set and file buffer for session execution.
  - `SemanticMemory`: Pluggable semantic memory layer with `SemanticStoreProvider` interface and `BasicSemanticStore` implementation.
  - `EpisodicMemory`: Agent trajectory and timeline event history store.
  - `TokenBudgetSummarizer`: Automatic token budget estimation and hierarchical summary generator for long conversation context pruning.
  - `CompositeMemory`: Unified multi-tier memory store combining short-term, working, semantic, and episodic stores.
- **Integration Tests**: Added Test 6 (Multi-tier memory store integration across ShortTerm, Scratchpad, Semantic, and Episodic memory) to `example-financial-governance`.

---

## [0.2.4] - 2026-08-10

### Added

- **NestJS 11 & NestJS 10 PeerDependency Support**: Updated `peerDependencies` across `@nestjs-agentic/core`, `@nestjs-agentic/memory`, `@nestjs-agentic/langgraph`, `@nestjs-agentic/adk`, and `nestjs-agentic` to `"^10.0.0 || ^11.0.0"`.
- **Unified StateStore Architecture**: Added `StateStore` interface in core with `InMemoryStateStore` and `RedisStateStore` registered centrally via `AgenticModule.forRoot({ stateStore })`.
- **LangGraph Stateful Checkpointer Persistence**: Added `BaseCheckpointSaver` state thread persistence and thread indexing (`MemorySaver`, `SqliteSaver`, `Redis`) to `@nestjs-agentic/langgraph`.
- **Structured Event Streaming (`runStream()`)**: Added typed `AgentStreamEvent` union (`tool_start`, `tool_result`, `approval_required`, `token`, `complete`) to `AgentRunner.runStream()` for Server-Sent Events (SSE).
- **Built-in Advanced Governance Policies**:
  - `RateLimitPolicy`: Sliding-window call frequency enforcement per tenant or user.
  - `CostLimitPolicy`: Multi-threshold financial evaluation (`allow` -> `require_approval` -> `deny`).

---

## [0.1.0] - 2026-08-09

### Added

- `@Agent()` decorator for declaring agent classes (auto-applies `@Injectable()`)
- `AgentProvider` interface for agent configuration (composition over inheritance)
- `@ToolSet()` decorator with name, description, and tags metadata (auto-applies `@Injectable()`)
- `@Tool()` decorator for marking methods as LLM-callable tools
- `@Param()` decorator for tool parameter metadata (`name` optional — defaults to method name)
- `@Context()` decorator for injecting `AgentContext` into tool methods
- `@UsePolicies()` decorator for attaching business rules to tools and tool sets
- `ToolPolicy` interface with 3-state `PolicyResult` (allow / deny / require_approval)
- `AgentContext` with security context (`userId`, `tenantId`, `roles`), `sessionId`, `traceId`, and custom `data` bag
- `LocalToolProvider` — scans `@ToolSet` instances, builds `ResolvedTool` closures with policy enforcement
- `ToolDiscoveryService` — pure reflection layer over decorator metadata
- `RuntimeAdapter` interface with `execute()` and optional `stream()`
- `AgentRunner` — main execution entry point; resolves agents by name, builds context, delegates to adapter
- `ApprovalService` — executes or rejects pending HITL tool closures
- `MockRuntimeAdapter` for testing without real LLM calls
- `@nestjs-agentic/adk` — Google ADK runtime adapter
- `@nestjs-agentic/langgraph` — LangGraph runtime adapter
