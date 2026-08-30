import { NextResponse } from 'next/server';

export async function GET() {
  const content = `# nestjs-agentic

> The NestJS-native runtime for governed AI agents.
> Define agents and tools with NestJS, enforce policy before side effects, and keep model integrations replaceable.

## Product Position

nestjs-agentic keeps agents, context-bound tools, policy evaluation, and deterministic testing inside the NestJS module and dependency-injection system. It focuses on bounded model decisions and application-owned security context rather than unconstrained autonomy.

## Current Status: v1.x General Availability (GA)

- Available: Agent and tool decorators (@Agent, @ToolSet, @Tool, @Param, @Context), NestJS discovery and dependency injection, allow/deny/require_approval policies, context-bound tools, built-in runtime with governed model-to-tool loops, argument validation, execution limits, cancellation (AbortSignal), streaming, per-session conversation history, OpenAI model adapter, reusable contract testing suites, durable Human-in-the-Loop checkpoints with atomic settlement, Redis/PostgreSQL persistence stores, 5-tier cognitive memory with Stanford tri-factor scoring, AST-aware code chunking with GraphRAG, bounded-concurrency parallel fan-out, multi-agent debate consensus scoring, and Model Context Protocol (MCP) client transports.
- Added since GA: module-level default policy chains (deny-by-default governance), a built-in prompt-injection sanitizer with RAG boundary wrapping, provenance/taint labeling across model, tool, and retrieved content, a PII redaction policy, approver authorization with separation-of-duties, a tamper-evident hash-chained audit trail, real Reciprocal Rank Fusion and BM25 scoring, Cohere/Voyage reranker adapters, MMR diversity selection, an embedding cache, model-call retry with backoff/jitter plus a circuit breaker, a distributed Redis-backed rate limit policy, and a provider-agnostic message reducer that bounds tool-loop context growth.

## Architecture Highlights

- Governed Tool Boundaries: Models never hold raw references to NestJS providers or application database connections.
- Durable Turn Checkpoints: Pending approvals are stored as serializable, versioned records enabling cross-process, crash-resilient turn resumption.
- Multi-Agent Collective Intelligence: Parallel sub-agent execution, dialectic debate rounds, and inter-rater reliability metrics.
- Cognitive Memory: Epistemic scratchpads, semantic vector stores, and episodic memory with recency/importance/relevance decay.
- Context Engineering: AST hierarchical code chunking and hybrid BM25 + dense vector search with cross-encoder reranking.
- Bounded Context Lifecycle: A configurable message reducer projects a compact view of the transcript to the model each round, while the canonical transcript, checkpoints, and approval resume stay complete.
- Model-Call Resilience: Retry with exponential backoff and jitter, plus a circuit breaker that fails fast during a provider outage, independent of adapter SDK retry behavior.

## Installation

\`\`\`bash
npm install nestjs-agentic
npm install @nestjs-agentic/openai openai
\`\`\`

Register the adapter through \`AgenticModule.forRoot({ modelAdapter })\` to activate the built-in runtime. The same adapter targets Azure, Ollama, vLLM, Groq, and OpenRouter through \`baseUrl\`.

## Links

- Documentation Site: https://agentic.alireza.work
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
