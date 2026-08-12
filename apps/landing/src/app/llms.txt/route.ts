import { NextResponse } from 'next/server';

export async function GET() {
  const content = `# nestjs-agentic

> The NestJS-native runtime for governed AI agents.
> Define agents and tools with NestJS, enforce policy before side effects, and keep model integrations replaceable.

## Product Position

nestjs-agentic keeps agents, context-bound tools, policy evaluation, and deterministic testing inside the NestJS module and dependency-injection system. It focuses on bounded model decisions and application-owned security context rather than unconstrained autonomy.

## Current Status: 0.4.x

- Available: agent and tool decorators, NestJS discovery and dependency injection, allow/deny/require_approval policies, context-bound tools, and MockRuntimeAdapter.
- Experimental: human approval, the synthetic ADK-named runtime prototype, limited LangGraph compatibility, streaming and state abstractions, memory, RAG, experience, orchestration, and evaluation.
- Planned: durable execution, standardized observability, resumable approval, and common provider/runtime contracts.

Published experimental packages are intended for evaluation and feedback. They do not imply production readiness.

## Important Runtime Limits

- Current approval continuation is process-local. Approval executes one pending tool invocation but does not resume the original model turn or survive restart.
- The current ADK-named prototype does not perform a provider-native ADK or model call. On every run it invokes resolved tools in registration order with empty arguments and stops early only when a tool returns pending_approval. Do not use it for side effects.
- The current LangGraph adapter does not compile a StateGraph. Its model path is a single invoke without a tool-call loop, and its fallback and stream behavior are synthetic. Do not use it for production side effects.
- Memory and RAG are experimental opt-in primitives and are not automatically attached to AgentRunner.

## Roadmap

- 0.5 Independent Agent Runtime: vendor-neutral model and message contracts, a complete governed model-to-tool loop, canonical streaming, cancellation, deadlines, budgets, argument validation, and shared adapter contract tests.
- 0.6 Durable and Observable Execution: versioned checkpoints, restart-safe approval, idempotency and retries, persistence adapters, traces and metrics, audit events, and hardened tenant and identity isolation.
- 0.7 Reliable Orchestration: cancellation-aware bounded fan-out, correct fallback and aggregation, resumable refinement, durable delegation, and workflow inspection APIs.

## Installation

npm install nestjs-agentic

Use MockRuntimeAdapter for deterministic agent, tool, and policy tests without a model API.

## Links

- GitHub Repository: https://github.com/irzix/nestjs-agentic
- NPM Core Package: https://www.npmjs.com/package/nestjs-agentic
- Architecture Guide: https://github.com/irzix/nestjs-agentic/blob/main/docs/ARCHITECTURE.md
- Product Roadmap: https://github.com/irzix/nestjs-agentic/blob/main/docs/ROADMAP.md
- API Reference: https://github.com/irzix/nestjs-agentic/blob/main/docs/API_REFERENCE.md
`;

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
