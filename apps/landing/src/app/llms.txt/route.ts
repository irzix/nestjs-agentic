import { NextResponse } from 'next/server';

export async function GET() {
  const content = `# nestjs-agentic

> The NestJS-native runtime for governed AI agents.
> Define agents and tools with NestJS, enforce policy before side effects, and keep model integrations replaceable.

## Product Position

nestjs-agentic keeps agents, context-bound tools, policy evaluation, and deterministic testing inside the NestJS module and dependency-injection system. It focuses on bounded model decisions and application-owned security context rather than unconstrained autonomy.

## Current Status: 0.5.x

- Available: agent and tool decorators, NestJS discovery and dependency injection, allow/deny/require_approval policies, context-bound tools, the built-in agent runtime with a governed model-to-tool loop, argument validation, execution budgets, cancellation, streaming, per-session conversation history, the OpenAI model adapter, the reusable model adapter contract suite, and deterministic mock adapters.
- Experimental: human approval durability, the synthetic ADK-named runtime prototype, limited LangGraph compatibility, memory, RAG, experience, orchestration, and evaluation.
- Planned: durable execution checkpoints, standardized observability, resumable approval, and reliable orchestration.

Published experimental packages are intended for evaluation and feedback. They do not imply production readiness.

## Important Runtime Limits

- Current approval continuation is process-local. Approval executes one pending tool invocation but does not resume the original model turn or survive restart.
- Conversation history is persisted per session, but in-flight execution state is not, so a restart loses a suspended turn.
- The current ADK-named prototype does not perform a provider-native ADK or model call. On every run it invokes resolved tools in registration order with empty arguments and stops early only when a tool returns pending_approval. Do not use it for side effects.
- The current LangGraph adapter does not compile a StateGraph. Its model path is a single invoke without a tool-call loop, and its fallback and stream behavior are synthetic. Do not use it for production side effects.
- Memory and RAG are experimental opt-in primitives and are not automatically attached to AgentRunner.

## Roadmap

- 0.5 Independent Agent Runtime: complete. Vendor-neutral model contracts, a governed model-to-tool loop, streaming, cancellation, budgets, argument validation, tool error recovery, conversation history, the OpenAI adapter, and a shared adapter contract suite.
- 0.6 Durable and Observable Execution: versioned checkpoints, restart-safe approval, idempotency and retries, persistence adapters, traces and metrics, audit events, and hardened tenant and identity isolation.
- 0.7 Reliable Orchestration: cancellation-aware bounded fan-out, correct fallback and aggregation, resumable refinement, durable delegation, and workflow inspection APIs.

## Installation

npm install nestjs-agentic
npm install @nestjs-agentic/openai openai

Register the adapter through AgenticModule.forRoot({ modelAdapter }) to activate the built-in runtime. The same adapter targets Azure, Ollama, vLLM, Groq, and OpenRouter through baseUrl.

Use MockModelAdapter for deterministic agent, tool, policy, and loop tests without a model API.

## Links

- GitHub Repository: https://github.com/irzix/nestjs-agentic
- NPM Core Package: https://www.npmjs.com/package/nestjs-agentic
- NPM OpenAI Adapter: https://www.npmjs.com/package/@nestjs-agentic/openai
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
