import { NextResponse } from 'next/server';

export async function GET() {
  const content = `# nestjs-agentic

> Agentic Integration & Governance Layer for NestJS Applications.
> Build, govern, and orchestrate autonomous AI agents inside NestJS backend services with full Dependency Injection, 3-state policy guards, and Human-in-the-Loop (HITL) approvals.

## What is nestjs-agentic?

nestjs-agentic is the enterprise Agentic infrastructure layer for NestJS. It brings together native NestJS primitives, ecosystem runtime adapters, multi-agent orchestration, and enterprise governance — making AI agents a first-class citizen in NestJS applications without architecture drift.

## The 4 Core Pillars

1. NestJS Primitives & DI Binding: Decorator-driven agent primitives (@Agent, @ToolSet, @Tool, @Param, @Context) using existing services and native NestJS Dependency Injection.
2. Governance & HITL Safety: 3-state evaluation pipeline (allow, deny, require_approval) before any agent tool call executes. Pause sensitive actions and resume via ApprovalService.
3. Pluggable Ecosystem Adapters: Official Google ADK runtime adapter (@nestjs-agentic/adk), Vercel AI SDK, LangGraph, or custom runtimes with zero framework lock-in.
4. Multi-Agent Orchestration: Sub-agent delegation via AgentConfig.subAgents with isolated sub-context governance.

## Quick Installation

npm install nestjs-agentic
npm install @nestjs-agentic/adk

## Product Roadmap & Release Phases

- Phase 0.1 (Current Released): Core Primitives, 3-State Policies, Google ADK Adapter, MockRuntimeAdapter for unit testing.
- Phase 0.2 (In Progress): Enterprise Governance Matrix (Composite Policies, Role-Aware HITL), Sub-Agent Delegation, Vercel AI SDK & LangGraph Adapters, MCP Transport.
- Phase 0.3 (Upcoming): Immutable Audit Trail (AuditEventStore), OpenTelemetry, Langfuse & Arize Phoenix integrations.
- Phase 1.0 (Planned): Durable HITL Workflows (Temporal.io & BullMQ), Distributed Redis Session & Approval Stores.

## Links & Documentation

- GitHub Repository: https://github.com/irzix/nestjs-agentic
- NPM Core Package: https://www.npmjs.com/package/nestjs-agentic
- NPM ADK Package: https://www.npmjs.com/package/@nestjs-agentic/adk
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
