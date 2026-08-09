<p align="center">
  <img src="https://raw.githubusercontent.com/irzix/nestjs-agentic/main/docs/assets/banner.jpeg" alt="nestjs-agentic banner" width="100%" />
</p>

<h1 align="center">nestjs-agentic</h1>

<p align="center">
  <b>Agentic Infrastructure & Governance Layer for NestJS</b><br>
  Build, govern, and orchestrate autonomous AI agents inside your existing NestJS services — without architecture drift.
</p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-v10%2B-E0234E?style=flat&logo=nestjs&logoColor=white" alt="NestJS" /></a>
  <a href="https://www.npmjs.com/package/nestjs-agentic"><img src="https://img.shields.io/npm/v/nestjs-agentic.svg?color=E0234E" alt="NPM Version" /></a>
  <a href="https://github.com/irzix/nestjs-agentic/actions"><img src="https://github.com/irzix/nestjs-agentic/actions/workflows/ci.yml/badge.svg" alt="CI Status" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.0%2B-blue?logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://github.com/irzix/nestjs-agentic/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/nestjs-agentic.svg?color=blue" alt="License" /></a>
</p>

---

## What is nestjs-agentic?

Most agentic frameworks force you to build outside your backend — a separate Python service, a standalone graph, a different runtime. **nestjs-agentic** is different.

It is the **agentic infrastructure layer for NestJS**: define agents and tools using the decorators you already know, enforce policy guardrails before every tool call, and wire your existing services into any LLM runtime — all inside the NestJS DI container.

```
NestJS Services (DB / APIs) ──► @ToolSet & @Tool ──► @UsePolicies ──► [ allow / deny / HITL ] ──► RuntimeAdapter ──► LLM
```

---

## The 4 Core Pillars

| Pillar | What it gives you |
|--------|-------------------|
| **NestJS Primitives & DI** | `@Agent`, `@ToolSet`, `@Tool`, `@Param`, `@Context` — full DI, no rewrites |
| **Governance & HITL Safety** | 3-state policy engine (`allow`, `deny`, `require_approval`) on every tool call |
| **Pluggable Runtime Adapters** | Google ADK, Vercel AI SDK, LangGraph, or custom — swap without touching tools |
| **Multi-Agent Orchestration** | Sub-agent delegation via `AgentConfig.subAgents` *(coming in v0.2)* |

---

## Installation

```bash
# Core package
npm install nestjs-agentic

# Google ADK Adapter (optional)
npm install @nestjs-agentic/adk
```

---

## Quick Start (3 Steps)

### 1. Define Policy & Tools

```typescript
import { Injectable } from '@nestjs/common';
import { ToolSet, Tool, Param, Context, UsePolicies } from 'nestjs-agentic';
import type { AgentContext, ToolPolicy, PolicyResult } from 'nestjs-agentic';

@Injectable()
export class RefundLimitPolicy implements ToolPolicy {
  async evaluate(
    ctx: AgentContext,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    return Number(args.amount) > 500
      ? { decision: 'require_approval', reason: 'Refund exceeds $500 threshold.' }
      : { decision: 'allow' };
  }
}

@ToolSet({ name: 'order', tags: ['order', 'sales'] })
export class OrderTools {
  constructor(private readonly orderService: OrderService) {}

  @Tool({ description: 'Refund an order by ID and amount' })
  @UsePolicies(RefundLimitPolicy)
  async refundOrder(
    @Param('orderId') orderId: string,
    @Param('amount') amount: number,
    @Context() ctx: AgentContext,
  ) {
    return this.orderService.refund(orderId, amount, ctx.security.userId);
  }
}
```

### 2. Define Agent & Module

```typescript
import { Module } from '@nestjs/common';
import { Agent, AgenticModule, RUNTIME_ADAPTER } from 'nestjs-agentic';
import type { AgentProvider, AgentConfig } from 'nestjs-agentic';
import { AdkRuntimeAdapter } from '@nestjs-agentic/adk';

@Agent({ name: 'customer-support', description: 'Handles order lookups and refund inquiries' })
export class SupportAgent implements AgentProvider {
  constructor(private readonly orderTools: OrderTools) {}

  define(): AgentConfig {
    return {
      instructions: 'You are a helpful customer support agent.',
      tools: [this.orderTools],
    };
  }
}

@Module({
  imports: [
    AgenticModule.forRoot({ defaultModel: { provider: 'google', model: 'gemini-2.0-flash' } }),
    AgenticModule.forFeature({
      agents: [SupportAgent],
      toolSets: [OrderTools],
      policies: [RefundLimitPolicy],
    }),
  ],
  providers: [{ provide: RUNTIME_ADAPTER, useClass: AdkRuntimeAdapter }],
})
export class SupportModule {}
```

### 3. Run Agent & Handle HITL Approvals

```typescript
import { Controller, Post, Body, Param } from '@nestjs/common';
import { AgentRunner, ApprovalService } from 'nestjs-agentic';

@Controller('support')
export class SupportController {
  constructor(
    private readonly runner: AgentRunner,
    private readonly approvalService: ApprovalService,
  ) {}

  @Post('chat')
  async chat(@Body() body: { sessionId: string; message: string }) {
    return this.runner.run('customer-support', {
      sessionId: body.sessionId,
      message: body.message,
      context: { userId: 'user_123', tenantId: 'acme' },
    });
  }

  /** Called by a human supervisor to approve a pending tool call. */
  @Post('approve/:id')
  async approve(@Param('id') id: string) {
    return this.approvalService.approve(id);
  }

  /** Called to reject and discard a pending tool call. */
  @Post('reject/:id')
  async reject(@Param('id') id: string) {
    return this.approvalService.reject(id);
  }
}
```

---

## Testing Without LLM API Keys

Use `MockRuntimeAdapter` to unit test your agents, tools, and policies without any real LLM calls:

```typescript
import { Test } from '@nestjs/testing';
import { AgenticModule, AgentRunner, MockRuntimeAdapter, RUNTIME_ADAPTER } from 'nestjs-agentic';

describe('SupportAgent — Refund Policy', () => {
  let runner: AgentRunner;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({ defaultModel: { provider: 'google', model: 'gemini-2.0-flash' } }),
        AgenticModule.forFeature({
          agents: [SupportAgent],
          toolSets: [OrderTools],
          policies: [RefundLimitPolicy],
        }),
      ],
      providers: [{ provide: RUNTIME_ADAPTER, useClass: MockRuntimeAdapter }],
    }).compile();

    runner = module.get(AgentRunner);
  });

  it('should require approval on refund > $500', async () => {
    const result = await runner.run('customer-support', {
      sessionId: 'test-session',
      message: 'Refund $600 for order #42',
    });

    expect(result.toolCalls[0].result.status).toBe('pending_approval');
  });
});
```

---

## Documentation

- 🗺️ [Product Roadmap & Architectural Vision](https://github.com/irzix/nestjs-agentic/blob/main/docs/ROADMAP.md)
- 📐 [Architecture Guide & Diagrams](https://github.com/irzix/nestjs-agentic/blob/main/docs/ARCHITECTURE.md)
- 📚 [API Reference](https://github.com/irzix/nestjs-agentic/blob/main/docs/API_REFERENCE.md)

---

## License

[MIT](LICENSE) © [irzix](https://github.com/irzix)
