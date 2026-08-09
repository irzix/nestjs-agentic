# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- `AgentConfig.subAgents` field for future multi-agent orchestration (v0.2)
- `ToolProvider` interface for pluggable tool sources (local, MCP, HTTP)
- `LocalToolProvider` — scans `@ToolSet` instances, builds `ResolvedTool` closures with policy enforcement
- `ToolDiscoveryService` — pure reflection layer over decorator metadata
- `RuntimeAdapter` interface with `execute()` and optional `stream()`
- `AgentRunner` — main execution entry point; resolves agents by name, builds context, delegates to adapter
- `ApprovalService` — executes or rejects pending HITL tool closures
- `SessionStore` interface with `InMemorySessionStore` default
- `ApprovalStore` interface with `InMemoryApprovalStore` default
- `AgentObserver` interface for observability hooks (v0.3)
- `AgenticModule` with `forRoot()` and `forFeature()` registration (implementation in progress)
- `MockRuntimeAdapter` for testing without real LLM calls (implementation in progress)
- `@nestjs-agentic/adk` — Google ADK runtime adapter (implementation in progress)

### Design Decisions

- **AgentContext is pre-bound in tool closures** — context never reaches the `RuntimeAdapter`
  or the LLM, preventing prompt bloat and ensuring security boundaries in multi-agent scenarios
- **Explicit policy registration** — policies must be listed in `forFeature({ policies: [] })`
  instead of resolved via `ModuleRef`, keeping the wiring explicit and testable
- **Optional tool name** — `@Tool({ description })` defaults the LLM-facing tool name to the
  method name; override with `@Tool({ name: 'custom_name', description })` when needed
- **In-memory stores as defaults** — `InMemoryApprovalStore` and `InMemorySessionStore` are
  provided out of the box; replace with Redis or any custom backend via DI tokens

