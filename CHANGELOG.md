# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.4] - 2026-08-10

### Added

- **NestJS 11 & NestJS 10 PeerDependency Support**: Updated `peerDependencies` across `@nestjs-agentic/core`, `@nestjs-agentic/memory`, `@nestjs-agentic/langgraph`, `@nestjs-agentic/adk`, and `nestjs-agentic` to `"^10.0.0 || ^11.0.0"`.
- **Unified StateStore Architecture**: Added `StateStore` interface in core with `InMemoryStateStore` and `RedisStateStore` registered centrally via `AgenticModule.forRoot({ stateStore })`.
- **Cognitive Memory Module (`@nestjs-agentic/memory`)**:
  - `ShortTermMemory`: Sliding-window session conversation history with configurable `maxMessages` token capping.
  - `ScratchpadMemory`: Active working task set and file buffer for session execution.
  - `CompositeMemory`: Unified multi-tier memory store combining short-term and working memory stores.
  - Full compatibility with core `StateStore` (both `InMemoryStateStore` and `RedisStateStore`).
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
- `AgentConfig.subAgents` field for future multi-agent orchestration
- `LocalToolProvider` — scans `@ToolSet` instances, builds `ResolvedTool` closures with policy enforcement
- `ToolDiscoveryService` — pure reflection layer over decorator metadata
- `RuntimeAdapter` interface with `execute()` and optional `stream()`
- `AgentRunner` — main execution entry point; resolves agents by name, builds context, delegates to adapter
- `ApprovalService` — executes or rejects pending HITL tool closures
- `MockRuntimeAdapter` for testing without real LLM calls
- `@nestjs-agentic/adk` — Google ADK runtime adapter
- `@nestjs-agentic/langgraph` — LangGraph runtime adapter
