# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `@Agent()` decorator for declaring agent classes
- `AgentProvider` interface for agent configuration (composition over inheritance)
- `@ToolSet()` decorator with name, description, and tags metadata
- `@Tool()` decorator for marking methods as LLM-callable tools
- `@Param()` decorator for tool parameter metadata
- `@Context()` decorator for injecting `AgentContext` into tool methods
- `@UsePolicies()` decorator for attaching business rules to tools and agents
- `ToolPolicy` interface with `PolicyResult` (allowed + reason)
- `AgentContext` with security context, session, tracing, and custom data bag
- `ToolProvider` interface for pluggable tool sources (local, MCP, HTTP)
- `LocalToolProvider` with policy enforcement baked into tool closures
- `RuntimeAdapter` interface with `execute()` and optional `stream()`
- `SessionStore` interface with `InMemorySessionStore` default
- `MemoryStore` interface (no implementation — ready for v1)
- `AgentObserver` interface for observability hooks
- `AgentRunner` service as the main execution entry point
- `AgenticModule` with `forRoot()` and `forFeature()` registration
- `MockRuntimeAdapter` for testing without real LLM calls
- `@nestjs-agentic/adk` — Google ADK runtime adapter
- Customer support demo application
