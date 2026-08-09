<p align="center">
  <img src="https://raw.githubusercontent.com/irzix/nestjs-agentic/main/docs/assets/banner.jpeg" alt="nestjs-agentic banner" width="100%" />
</p>

<h1 align="center">nestjs-agentic</h1>

<p align="center">
  <b>AI Integration Layer for NestJS Applications</b><br>
  Transform existing backend services into safe, type-safe, policy-guarded AI tools without altering architecture.
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

Most AI frameworks force you to build a separate ecosystem or abandon your backend patterns. **nestjs-agentic** is an **AI integration layer for NestJS** that makes AI capabilities a first-class citizen in your existing NestJS codebase.

It allows you to expose existing NestJS services as **type-safe, policy-guarded tools** for LLMs using standard NestJS Dependency Injection, complete with **built-in Human-in-the-Loop (HITL)** approvals.

```
Your NestJS App (Services / DB) ──► @ToolSet & @Tool ──► @UsePolicies (HITL) ──► RuntimeAdapter (ADK / LangGraph / Mock) ──► LLM
```

---

## Features at a Glance

- 🛠️ **NestJS Native:** Decorator-driven tool definitions (`@ToolSet`, `@Tool`, `@Param`) using existing services.
- 🛡️ **Policy Governance:** 3-state evaluation pipeline (`allow`, `deny`, `require_approval`) before tool execution.
- 🛑 **Human-in-the-Loop (HITL):** Pause sensitive tool executions and resume after supervisor approval via `ApprovalService`.
- 🔒 **Context Isolation:** Auto-inject `userId`, `tenantId`, and `traceId` straight into tool closures via `@Context()` — zero LLM prompt leakage.
- 🔌 **Adapter Agnostic:** Works with Google ADK (`@nestjs-agentic/adk`), Vercel AI SDK, LangGraph, or custom runtimes.
- 🧪 **Mock-First Testing:** Includes `MockRuntimeAdapter` for unit testing tools and policies without live LLM API calls.

---

## Installation

```bash
# Core package
npm install nestjs-agentic

# Google ADK Adapter
npm install @nestjs-agentic/adk
```

---

## Quick Start (3 Steps)

### 1. Define Policy & Tools

```typescript
import { Injectable } from '@nestjs/common';
import { ToolSet, Tool, Param, Context, UsePolicies, AgentContext, ToolPolicy, PolicyResult } from 'nestjs-agentic';

@Injectable()
export class RefundLimitPolicy implements ToolPolicy {
  async evaluate(ctx: AgentContext, toolName: string, args: Record<string, unknown>): Promise<PolicyResult> {
    return Number(args.amount) > 500
      ? { decision: 'require_approval', reason: 'Refund exceeds $500 threshold.' }
      : { decision: 'allow' };
  }
}

@ToolSet({ name: 'order' })
export class OrderTools {
  constructor(private readonly orderService: OrderService) {}

  @Tool({ description: 'Refund an order' })
  @UsePolicies(RefundLimitPolicy)
  async refundOrder(@Param('orderId') orderId: string, @Param('amount') amount: number) {
    return this.orderService.refund(orderId, amount);
  }
}
```

### 2. Define Agent & Module

```typescript
import { Agent, AgentProvider, AgentConfig, AgenticModule, RUNTIME_ADAPTER } from 'nestjs-agentic';
import { AdkRuntimeAdapter } from '@nestjs-agentic/adk';

@Agent({ name: 'customer-support', model: { provider: 'google', model: 'gemini-2.0-flash' } })
export class SupportAgent implements AgentProvider {
  constructor(private readonly orderTools: OrderTools) {}
  define(): AgentConfig {
    return { instructions: 'Helpful support agent.', tools: [this.orderTools] };
  }
}

@Module({
  imports: [
    AgenticModule.forRoot({ defaultModel: { provider: 'google', model: 'gemini-2.0-flash' } }),
    AgenticModule.forFeature({ agents: [SupportAgent], toolSets: [OrderTools], policies: [RefundLimitPolicy] }),
  ],
  providers: [{ provide: RUNTIME_ADAPTER, useClass: AdkRuntimeAdapter }],
})
export class SupportModule {}
```

### 3. Controller Execution & Approval

```typescript
@Controller('support')
export class SupportController {
  constructor(
    private readonly runner: AgentRunner,
    private readonly approvalService: ApprovalService,
  ) {}

  @Post('chat')
  async chat(@Body() body: { sessionId: string; message: string }) {
    return this.runner.run('customer-support', { sessionId: body.sessionId, message: body.message });
  }

  @Post('approve/:id')
  async approve(@Param('id') id: string) {
    return this.approvalService.approve(id);
  }
}
```

---

## Testing & Examples

- 🧪 **Unit Testing:** Use `MockRuntimeAdapter` to test agent flows without LLM API keys. See the [API Reference](docs/API_REFERENCE.md#mockruntimeadapter) for examples.
- 🚀 **Full Modular Application Example:** Explore the complete customer support demo app in [examples/customer-support](examples/customer-support).

---

## Documentation & Vision

- 🗺️ [Product Roadmap & Architectural Vision](docs/ROADMAP.md)
- 📐 [Architecture Guide & Diagrams](docs/ARCHITECTURE.md)
- 📚 [API Reference](docs/API_REFERENCE.md)
- 🤝 [Contributing Guide](CONTRIBUTING.md)

---

## License

[MIT](LICENSE) © [irzix](https://github.com/irzix)
