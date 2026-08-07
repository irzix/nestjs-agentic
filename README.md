<p align="center">
  <img src="docs/assets/logo-placeholder.png" alt="nestjs-agentic" width="200" />
</p>

<h1 align="center">nestjs-agentic</h1>

<p align="center">
  AI Integration Layer for NestJS Applications — Transform existing backend services into safe, AI-native tools without breaking architecture.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/nestjs-agentic"><img src="https://img.shields.io/npm/v/nestjs-agentic.svg" alt="NPM Version" /></a>
  <a href="https://www.npmjs.com/package/nestjs-agentic"><img src="https://img.shields.io/npm/l/nestjs-agentic.svg" alt="License" /></a>
  <a href="https://www.npmjs.com/package/nestjs-agentic"><img src="https://img.shields.io/npm/dm/nestjs-agentic.svg" alt="Downloads" /></a>
</p>

---

## What is nestjs-agentic?

Most AI frameworks force you to build a separate ecosystem or abandon your backend patterns. **nestjs-agentic** is an **AI integration layer for NestJS** that makes AI capabilities a first-class citizen in your existing codebase.

It allows you to expose your existing NestJS services as **type-safe, policy-guarded tools** for LLMs using standard NestJS Dependency Injection, complete with **built-in Human-in-the-Loop (HITL)** approvals.

```
Incoming Request (HTTP / SSE / Queue)
         │
  SupportController
         │
   AgentRunner.run('customer-support')
         │
  SupportAgent (AgentProvider)
         │
  OrderTools (@ToolSet) ──▶ PolicyExecutor (@UsePolicies)
         │                       │
         │           ┌───────────┴───────────┐
         │           ▼                       ▼
         │       { decision: 'allow' }   { decision: 'require_approval' }
         │           │                       │
         ▼           ▼                       ▼
   LocalToolProvider (ResolvedTool)     ApprovalService (approvalId)
         │                                   │
   RuntimeAdapter (ADK / Mock / Vercel)      ▼
         │                           Human Approval Endpoint
    LLM Provider                     (/support/approve/:id)
```

---

## Why nestjs-agentic?

- 🛠️ **NestJS Native:** Decorator-driven tool definitions (`@ToolSet`, `@Tool`, `@Param`) using your existing services.
- 🛡️ **Policy Governance:** Enforce security constraints, tenant bounds, and rate limits before tool execution.
- 🛑 **Human-in-the-Loop (HITL) Primitives:** Pause sensitive tool executions and resume them after supervisor approval via `ApprovalService`.
- 🔒 **Context Aware:** Auto-inject `userId`, `tenantId`, and `traceId` straight into tool handlers via `@Context()`.
- 🔌 **Adapter Agnostic:** Core knows nothing about specific LLM runtimes. Works with Google ADK, Vercel AI SDK, or custom providers.
- 🧪 **Test First:** Ships with `MockRuntimeAdapter` for testing tools and agents without live LLM API keys.

---

## Installation

```bash
# Core package
npm install nestjs-agentic

# Optional runtime adapters
npm install @nestjs-agentic/adk
```

---

## Quick Start (End-to-End Flow)

### 1. Define Policy & Tools

```typescript
import { Injectable } from '@nestjs/common';
import { ToolSet, Tool, Param, Context, UsePolicies, AgentContext, ToolPolicy, PolicyResult } from 'nestjs-agentic';

// Policy requiring human approval for refunds over $500
@Injectable()
export class RefundLimitPolicy implements ToolPolicy {
  async evaluate(ctx: AgentContext, toolName: string, args: Record<string, unknown>): Promise<PolicyResult> {
    const amount = Number(args.amount);
    if (amount > 500) {
      return {
        decision: 'require_approval',
        reason: `Refund of $${amount} exceeds auto-approval limit ($500).`,
      };
    }
    return { decision: 'allow' };
  }
}

// ToolSet leveraging existing OrderService
@ToolSet({ name: 'order', tags: ['order', 'sales'] })
export class OrderTools {
  constructor(private orderService: OrderService) {}

  @Tool({ description: 'Look up customer order details' })
  async getOrder(
    @Param('orderId', { description: 'The order ID' }) orderId: string,
    @Context() ctx: AgentContext,
  ) {
    return this.orderService.findById(orderId, ctx.userId);
  }

  @Tool({ description: 'Request a refund for an order' })
  @UsePolicies(RefundLimitPolicy)
  async refundOrder(
    @Param('orderId') orderId: string,
    @Param('amount') amount: number,
  ) {
    return this.orderService.refund(orderId, amount);
  }
}
```

### 2. Define Agent & Module

```typescript
import { Agent, AgentProvider, AgentConfig, AgenticModule, RUNTIME_ADAPTER } from 'nestjs-agentic';
import { AdkRuntimeAdapter } from '@nestjs-agentic/adk';

@Agent({
  name: 'customer-support',
  description: 'Handles order lookup and refund inquiries',
  model: { provider: 'google', model: 'gemini-2.0-flash' },
})
export class SupportAgent implements AgentProvider {
  constructor(private orderTools: OrderTools) {}

  define(): AgentConfig {
    return {
      instructions: 'You are a helpful customer support assistant.',
      tools: [this.orderTools],
    };
  }
}

@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel: { provider: 'google', model: 'gemini-2.0-flash' },
    }),
    AgenticModule.forFeature({
      agents: [SupportAgent],
      toolSets: [OrderTools],
    }),
  ],
  providers: [
    { provide: RUNTIME_ADAPTER, useClass: AdkRuntimeAdapter },
  ],
})
export class SupportModule {}
```

### 3. Controller Execution & Approval Endpoint

```typescript
@Controller('support')
export class SupportController {
  constructor(
    private agentRunner: AgentRunner,
    private approvalService: ApprovalService,
  ) {}

  @Post('chat')
  async chat(@Body() body: { sessionId: string; message: string }, @Req() req) {
    return this.agentRunner.run('customer-support', {
      sessionId: body.sessionId,
      message: body.message,
      context: { userId: req.user.id },
    });
  }

  // Endpoint to approve pending HITL tool calls
  @Post('approve/:approvalId')
  async approve(@Param('approvalId') approvalId: string) {
    return this.approvalService.approve(approvalId);
  }
}
```

---

## Testing

Test tool invocation and policy guards with `MockRuntimeAdapter` without live LLM calls:

```typescript
import { Test } from '@nestjs/testing';
import { MockRuntimeAdapter, RUNTIME_ADAPTER, AgentRunner } from 'nestjs-agentic';

describe('OrderTools HITL', () => {
  let runner: AgentRunner;
  let mockRuntime: MockRuntimeAdapter;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({ defaultModel: { provider: 'mock', model: 'test' } }),
        AgenticModule.forFeature({ agents: [SupportAgent], toolSets: [OrderTools] }),
      ],
    })
      .overrideProvider(RUNTIME_ADAPTER)
      .useClass(MockRuntimeAdapter)
      .compile();

    runner = module.get(AgentRunner);
    mockRuntime = module.get(RUNTIME_ADAPTER);
  });

  it('should trigger pending_approval on refund over limit', async () => {
    mockRuntime.whenAsked('Refund $600 for order #123')
      .thenCallTool('refundOrder', { orderId: '123', amount: 600 });

    const result = await runner.run('customer-support', {
      sessionId: 'test-session',
      message: 'Refund $600 for order #123',
    });

    expect(result.toolCalls[0].result).toEqual(
      expect.objectContaining({ status: 'pending_approval' }),
    );
  });
});
```

---

## Roadmap

- [x] **v0.1 Lean Core:** NestJS Tool Decorators (`@ToolSet`, `@Tool`, `@Param`, `@Context`)
- [x] **v0.1 Policy & HITL:** `@UsePolicies` with working 3-state `PolicyResult` and `ApprovalService`
- [x] **v0.1 Testing:** Built-in `MockRuntimeAdapter`
- [ ] **v0.2 Transports:** MCP (Model Context Protocol) `ToolProvider` support
- [ ] **v0.2 Adapters:** Official Vercel AI SDK & LangGraph `RuntimeAdapter` implementations
- [ ] **v0.3 Observability:** OpenTelemetry & Langfuse `AgentObserver` implementations
- [ ] **v1.0 Async Workflows:** Long-running Temporal & BullMQ execution primitives

---

## License

[MIT](LICENSE)
