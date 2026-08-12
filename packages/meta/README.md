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

## What is nestjs-agentic?

`nestjs-agentic` keeps agent-facing capabilities inside the NestJS module and dependency-injection system. Application services remain ordinary providers; runtimes receive context-bound tool closures that evaluate policy before invoking side effects.

```text
NestJS service
    -> @ToolSet and @Tool
    -> context-bound ResolvedTool
    -> allow / deny / require_approval
    -> RuntimeAdapter
```

## Current Status

The current release line is `0.4.x`. Published does not mean production-ready, and breaking changes remain possible before 1.0.

| Area | Status | Scope |
| --- | --- | --- |
| Agents, tools, NestJS DI, policies, mock runtime | Available | Core decorators, discovery, context-bound execution, governance decisions, and deterministic tests. |
| Built-in agent runtime | Available | Governed model-to-tool loop with argument validation, execution budgets, cancellation, and streaming. Requires a `ModelAdapter`. |
| Other model providers | Planned | Anthropic, Google, and Vercel AI SDK adapters will follow the same `ModelAdapter` contract. |
| Human approval | Experimental | Approve/reject an individual process-local tool invocation; durable pause/resume is not available. |
| OpenAI model adapter | Available | `@nestjs-agentic/openai` for OpenAI and Chat Completions compatible endpoints. |
| ADK prototype and LangGraph adapter | Experimental | The ADK-named package is a synthetic runtime prototype; the LangGraph package offers limited compatibility with adapter-specific limitations. |
| Memory, RAG, experience, orchestration, evaluation | Experimental | Optional packages that applications must integrate explicitly. |
| Durable execution and observability | Planned | Recovery, resumable approval, standardized tracing, and audit events. |
| Vercel AI SDK and MCP | Planned | Future integrations over the common runtime and governance contracts. |

## Installation

```bash
npm install nestjs-agentic
```

Use `MockRuntimeAdapter` for deterministic governance tests without a model API. The current `@nestjs-agentic/adk` package is a synthetic runtime prototype, while `@nestjs-agentic/langgraph` provides limited compatibility. Review their package READMEs before evaluation.

## Minimal Governed Tool

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

The current approval continuation is stored as a process-local closure. Approval executes that pending tool invocation but does not resume the original model turn or survive a restart.

## Documentation

- [Product Roadmap](https://github.com/irzix/nestjs-agentic/blob/main/docs/ROADMAP.md)
- [Architecture Guide](https://github.com/irzix/nestjs-agentic/blob/main/docs/ARCHITECTURE.md)
- [API Reference](https://github.com/irzix/nestjs-agentic/blob/main/docs/API_REFERENCE.md)

## License

[MIT](https://github.com/irzix/nestjs-agentic/blob/main/LICENSE) © [irzix](https://github.com/irzix)
