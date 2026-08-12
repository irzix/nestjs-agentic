<p align="center">
  <img src="https://raw.githubusercontent.com/irzix/nestjs-agentic/main/docs/assets/banner.jpeg" alt="nestjs-agentic banner" width="100%" />
</p>

<h1 align="center">nestjs-agentic</h1>

<p align="center">
  <b>The NestJS-native runtime for governed AI agents</b><br>
  Define agents and tools with NestJS, enforce policy before side effects, and keep model integrations replaceable.
</p>

<p align="center">
  <a href="https://nestjs.com"><img src="https://img.shields.io/badge/NestJS-v10%20%7C%20v11-E0234E?style=flat&logo=nestjs&logoColor=white" alt="NestJS" /></a>
  <a href="https://www.npmjs.com/package/nestjs-agentic"><img src="https://img.shields.io/npm/v/nestjs-agentic.svg?color=E0234E" alt="NPM Version" /></a>
  <a href="https://github.com/irzix/nestjs-agentic/actions"><img src="https://github.com/irzix/nestjs-agentic/actions/workflows/ci.yml/badge.svg" alt="CI Status" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.0%2B-blue?logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://github.com/irzix/nestjs-agentic/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/nestjs-agentic.svg?color=blue" alt="License" /></a>
</p>

## Why nestjs-agentic?

Most agent frameworks introduce a separate runtime and application boundary. nestjs-agentic keeps agent-facing capabilities inside the NestJS module and dependency-injection system:

```text
NestJS service
    -> @ToolSet and @Tool
    -> context-bound ResolvedTool
    -> allow / deny / require_approval policy decision
    -> RuntimeAdapter
```

Application services remain ordinary NestJS providers. The model runtime receives governed tool closures rather than direct access to services or application-owned security context.

## Current Capabilities

The current release line is `0.4.x`. Core primitives are available; runtime, persistence, and orchestration packages remain experimental while their behavior is standardized.

| Area | Status | Scope |
| --- | --- | --- |
| Agents, tools, and NestJS DI | Available | Decorators, discovery, feature registration, and context-bound tools. |
| Tool governance | Available | `allow`, `deny`, and `require_approval` before framework-managed tool execution. |
| Mock runtime | Available | Deterministic tool and policy testing without a model API. |
| Human approval | Experimental | Approve and reject APIs are available; pause/resume is not durable across process restarts. |
| ADK prototype and LangGraph adapter | Experimental | `@nestjs-agentic/adk` is currently a synthetic runtime prototype; `@nestjs-agentic/langgraph` provides limited compatibility with adapter-specific behavior. Full graph execution is not part of the current LangGraph adapter. |
| Streaming and state | Experimental | Shared abstractions exist, but execution recovery and adapter semantics are not yet unified. |
| Memory, RAG, experience, orchestration, evaluation | Experimental | Opt-in packages available for evaluation and feedback. |
| Durable execution and observability | Planned | Checkpoint recovery, resumable HITL, standardized tracing, and audit events are roadmap work. |

See the [product roadmap](docs/ROADMAP.md) for milestones and production-readiness criteria.

## Installation

```bash
npm install nestjs-agentic
```

Optional packages:

```bash
npm install @nestjs-agentic/memory
npm install @nestjs-agentic/rag @nestjs-agentic/memory
npm install @nestjs-agentic/experience @nestjs-agentic/memory
npm install @nestjs-agentic/orchestration
npm install @nestjs-agentic/evaluation
npm install @nestjs-agentic/adk
npm install @nestjs-agentic/langgraph @langchain/core @langchain/langgraph
```

## Quick Start

The example uses `MockRuntimeAdapter`, so it is deterministic and requires no API key.

### 1. Define a policy and tool set

```typescript
import { Injectable } from '@nestjs/common';
import {
  AgentContext,
  Context,
  Param,
  PolicyResult,
  Tool,
  ToolPolicy,
  ToolSet,
  UsePolicies,
} from 'nestjs-agentic';

@Injectable()
export class RefundLimitPolicy implements ToolPolicy {
  async evaluate(
    _ctx: AgentContext,
    _toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    return Number(args.amount) > 500
      ? { decision: 'require_approval', reason: 'Refund exceeds $500.' }
      : { decision: 'allow' };
  }
}

@ToolSet({ name: 'orders' })
export class OrderTools {
  @Tool({ name: 'refundOrder', description: 'Refund an order' })
  @UsePolicies(RefundLimitPolicy)
  async refundOrder(
    @Param('orderId') orderId: string,
    @Param('amount', { type: 'number' }) amount: number,
    @Context() ctx: AgentContext,
  ) {
    return { orderId, amount, requestedBy: ctx.security.userId };
  }
}
```

### 2. Define an agent and module

```typescript
import { Module } from '@nestjs/common';
import {
  Agent,
  AgentConfig,
  AgenticModule,
  AgentProvider,
  MockRuntimeAdapter,
  RUNTIME_ADAPTER,
} from 'nestjs-agentic';

@Agent({ name: 'support', description: 'Handles support requests' })
export class SupportAgent implements AgentProvider {
  constructor(private readonly orderTools: OrderTools) {}

  define(): AgentConfig {
    return {
      instructions: 'Help the user while respecting tool policies.',
      tools: [this.orderTools],
    };
  }
}

const mockRuntime = new MockRuntimeAdapter();
mockRuntime
  .whenAsked('Refund $600 for order #42')
  .thenCallTool('refundOrder', { orderId: '42', amount: 600 });

@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel: { provider: 'mock', model: 'deterministic' },
    }),
    AgenticModule.forFeature({
      agents: [SupportAgent],
      toolSets: [OrderTools],
      policies: [RefundLimitPolicy],
    }),
  ],
  providers: [{ provide: RUNTIME_ADAPTER, useValue: mockRuntime }],
})
export class AppModule {}
```

### 3. Run the agent and handle approval

```typescript
import { Body, Controller, Param, Post } from '@nestjs/common';
import { AgentRunner, ApprovalService } from 'nestjs-agentic';

@Controller('support')
export class SupportController {
  constructor(
    private readonly runner: AgentRunner,
    private readonly approvals: ApprovalService,
  ) {}

  @Post('chat')
  chat(@Body() body: { sessionId: string; message: string }) {
    return this.runner.run('support', {
      sessionId: body.sessionId,
      message: body.message,
      context: {
        userId: 'user_123',
        tenantId: 'acme',
      },
    });
  }

  @Post('approve/:id')
  approve(@Param('id') id: string) {
    return this.approvals.approve(id);
  }

  @Post('reject/:id')
  reject(@Param('id') id: string) {
    return this.approvals.reject(id);
  }
}
```

`runner.runStream()` exposes structured `token`, `tool_start`, `tool_result`, `approval_required`, and `complete` events. Event behavior currently depends on the selected runtime adapter.

## Built-in Policies

- `RateLimitPolicy` — process-local sliding-window limits by tenant, user, and tool.
- `CostLimitPolicy` — numeric allow, approval, and deny thresholds.
- `LoggingPolicy` — configurable tool-attempt logging with field masking.

These are framework primitives, not replacements for distributed rate limiting, durable audit storage, or application authorization.

## Runtime Adapters

Applications provide a `RuntimeAdapter` through the `RUNTIME_ADAPTER` token. The core package does not import model or graph SDKs.

```typescript
{
  provide: RUNTIME_ADAPTER,
  useClass: MyRuntimeAdapter,
}
```

The current `@nestjs-agentic/adk` package is a synthetic runtime prototype, while `@nestjs-agentic/langgraph` provides limited compatibility with LangChain model and checkpointer types. Both are experimental. The roadmap prioritizes a provider-neutral model contract and independent tool-calling runtime before additional adapters.

## Documentation

- [Product Roadmap](docs/ROADMAP.md)
- [Architecture Guide](docs/ARCHITECTURE.md)
- [Core API Reference](docs/API_REFERENCE.md)
- [Contributing Guide](CONTRIBUTING.md)

Runnable examples are available in [`examples`](examples).

## License

[MIT](LICENSE) © [irzix](https://github.com/irzix)
