import { NextResponse } from 'next/server';

export async function GET() {
  const content = `# nestjs-agentic

> AI Integration & Governance Layer for NestJS Applications.
> Expose existing backend services as safe, type-safe, policy-guarded AI tools with built-in Human-in-the-Loop (HITL) approvals.

## What is nestjs-agentic?

nestjs-agentic is a NestJS-native package that brings AI tool-calling and governance to enterprise Node.js applications. It allows developers to decorate existing NestJS services with @ToolSet, @Tool, @Param, and @Context decorators, enforcing 3-state policies (allow, deny, require_approval) before any LLM executes code.

## Key Features

- NestJS Native: Decorator-driven tool definitions with full Dependency Injection support.
- Policy Governance: 3-state evaluation pipeline (allow, deny, require_approval).
- Human-in-the-Loop (HITL): Pause sensitive tool executions and resume after supervisor approval via ApprovalService.
- Context Isolation: Auto-inject userId, tenantId, and traceId straight into tool closures via @Context() — zero LLM prompt leakage.
- Adapter Agnostic: Works with Google ADK (@nestjs-agentic/adk), Vercel AI SDK, LangGraph, or custom runtimes.
- Mock-First Testing: Includes MockRuntimeAdapter for unit testing tools and policies without live LLM API keys.

## Quick Installation

npm install nestjs-agentic
npm install @nestjs-agentic/adk

## Links & Documentation

- GitHub Repository: https://github.com/irzix/nestjs-agentic
- NPM Core Package: https://www.npmjs.com/package/nestjs-agentic
- NPM ADK Package: https://www.npmjs.com/package/@nestjs-agentic/adk
- Architecture Guide: https://github.com/irzix/nestjs-agentic/blob/main/docs/ARCHITECTURE.md
- API Reference: https://github.com/irzix/nestjs-agentic/blob/main/docs/API_REFERENCE.md
`;

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
