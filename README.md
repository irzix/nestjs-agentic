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

The current release line is `0.6.x`. Core primitives, persistence adapters, and durable execution checkpoints are production-intent; higher-order orchestration packages remain experimental while their contracts stabilize.

| Area | Status | Scope |
| --- | --- | --- |
| Agents, tools, and NestJS DI | Available | Decorators, discovery, feature registration, and context-bound tools. |
| Tool governance | Available | `allow`, `deny`, and `require_approval` before framework-managed tool execution. |
| Model Context Protocol (MCP) | Available | `@nestjs-agentic/mcp` for Stdio and SSE remote tool discovery and execution. |
| Built-in agent runtime | Available | Model-to-tool loop, argument validation, execution budgets, cancellation, and streaming. Needs a `ModelAdapter`. |
| OpenAI model adapter | Available | `@nestjs-agentic/openai` for OpenAI and Chat Completions compatible endpoints such as Azure, Ollama, vLLM, Groq, and OpenRouter. |
| Mock runtime and mock model | Available | Deterministic agent, tool, policy, and loop testing without a model API. |
| Other model providers | Planned | Anthropic, Google, and Vercel AI SDK adapters will follow the same contract. |
| Human approval & HITL | Available | The runtime suspends a turn on `require_approval`; resumes durably via `ApprovalStore` and execution checkpoints. |
| Persistence adapters | Available | In-memory, Redis, and PostgreSQL drivers for `SessionStore`, `StateStore`, `ApprovalStore`, and `IdempotencyStore`. |
| Durable execution checkpoints | Available | In-flight execution checkpoints, crash recovery, and turn resumption without re-executing completed side-effects. |
| ADK prototype and LangGraph adapter | Experimental | `@nestjs-agentic/adk` is currently a synthetic runtime prototype; `@nestjs-agentic/langgraph` provides compatibility with adapter-specific behavior. |
| Memory, RAG, experience, orchestration, evaluation | Experimental | Opt-in packages available for evaluation and feedback. |

See the [product roadmap](docs/ROADMAP.md) for milestones and production-readiness criteria.

## Packages

| Package | Purpose |
| --- | --- |
| [`nestjs-agentic`](packages/meta) | Meta package that re-exports the core framework |
| [`@nestjs-agentic/core`](packages/core) | Agents, tools, policies, approvals, the built-in runtime, and the adapter contracts |
| [`@nestjs-agentic/mcp`](packages/mcp) | Model Context Protocol (MCP) client transport and tool provider |
| [`@nestjs-agentic/openai`](packages/model-openai) | OpenAI `ModelAdapter`, also covering Chat Completions compatible endpoints |
| [`@nestjs-agentic/memory`](packages/memory) | Short-term, semantic, episodic, and scratchpad memory primitives |
| [`@nestjs-agentic/rag`](packages/rag) | Retrieval strategies, vector stores, and knowledge-graph primitives |
| [`@nestjs-agentic/experience`](packages/experience) | Reflection and experience learning over memory |
| [`@nestjs-agentic/orchestration`](packages/orchestration) | Sub-agent delegation, parallel execution, and refinement loops |
| [`@nestjs-agentic/evaluation`](packages/evaluation) | Metrics, benchmark execution, and reporting |
| [`@nestjs-agentic/adk`](packages/runtime-adk) | Experimental runtime prototype, not a provider integration |
| [`@nestjs-agentic/langgraph`](packages/runtime-langgraph) | Experimental LangChain and LangGraph compatibility adapter |

## Installation

```bash
npm install nestjs-agentic
```

Connect a model provider:

```bash
npm install @nestjs-agentic/openai openai
```

Optional packages:

```bash
npm install @nestjs-agentic/mcp
npm install @nestjs-agentic/memory
npm install @nestjs-agentic/rag @nestjs-agentic/memory
npm install @nestjs-agentic/experience @nestjs-agentic/memory
npm install @nestjs-agentic/orchestration
npm install @nestjs-agentic/evaluation
npm install @nestjs-agentic/adk
npm install @nestjs-agentic/langgraph @langchain/core @langchain/langgraph
```

## Quick Start

The example uses `MockModelAdapter`, so the full tool-calling loop runs deterministically without an API key. Swap in your own `ModelAdapter` to talk to a real provider.

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
  MockModelAdapter,
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

const model = new MockModelAdapter();
model
  .whenAsked('Refund $600 for order #42')
  .callTool('refundOrder', { orderId: '42', amount: 600 })
  .reply('That refund needs approval before I can complete it.');

@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel: { provider: 'mock', model: 'deterministic' },
      modelAdapter: model,
      limits: { maxIterations: 6 },
    }),
    AgenticModule.forFeature({
      agents: [SupportAgent],
      toolSets: [OrderTools],
      policies: [RefundLimitPolicy],
    }),
  ],
})
export class AppModule {}
```

`AgenticModule.forFeature()` registers these classes inside `AgenticModule`. Keep an agent, its tool sets, and its policies in a single `forFeature()` call, and export any application services they inject from a `@Global()` module.

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

`runner.runStream()` exposes structured `token`, `tool_start`, `tool_result`, `approval_required`, and `complete` events.

Each run is bounded. Pass `limits` and a `signal` to cap iterations, tool calls, tokens, and wall-clock time, or to cancel work in flight:

```typescript
await runner.run('support', {
  sessionId,
  message,
  limits: { maxIterations: 4, maxToolCalls: 8, timeoutMs: 30_000 },
  signal: abortController.signal,
});
```

## Built-in Policies

- `RateLimitPolicy` — process-local sliding-window limits by tenant, user, and tool.
- `CostLimitPolicy` — numeric allow, approval, and deny thresholds.
- `LoggingPolicy` — configurable tool-attempt logging with field masking.

These are framework primitives, not replacements for distributed rate limiting, durable audit storage, or application authorization.

## Connecting a Model

For OpenAI and any Chat Completions compatible endpoint, use the published adapter:

```typescript
import { AgenticModule } from 'nestjs-agentic';
import { OpenAiModelAdapter } from '@nestjs-agentic/openai';

AgenticModule.forRoot({
  defaultModel: { provider: 'openai', model: 'gpt-4o-mini' },
  modelAdapter: new OpenAiModelAdapter({ apiKey: process.env.OPENAI_API_KEY }),
});
```

The same adapter targets local and third-party servers by pointing `baseUrl` at them, for example `http://localhost:11434/v1` for Ollama. See [`@nestjs-agentic/openai`](packages/model-openai) for Azure, reasoning models, and compatibility notes.

For any other provider, implement `ModelAdapter` directly. It handles only provider communication; the framework owns the loop, validation, policies, budgets, and streaming.

```typescript
import type { ModelAdapter, ModelRequest, ModelResponse } from 'nestjs-agentic';

export class MyModelAdapter implements ModelAdapter {
  async generate(request: ModelRequest): Promise<ModelResponse> {
    const completion = await callProvider({
      model: request.model.model,
      messages: request.messages,
      tools: request.tools,
      signal: request.signal,
    });

    return {
      content: completion.text,
      toolCalls: completion.toolCalls,
      usage: completion.usage,
      finishReason: completion.toolCalls.length ? 'tool_calls' : 'stop',
    };
  }
}
```

The core package does not import model or graph SDKs. Applications that already own an external runtime can still register a `RuntimeAdapter` through `RUNTIME_ADAPTER`, which continues to receive whole turns.

The current `@nestjs-agentic/adk` package is a synthetic runtime prototype, while `@nestjs-agentic/langgraph` provides limited compatibility with LangChain model and checkpointer types. Both are experimental, and the roadmap moves them onto the common contracts.

## Documentation

- [Product Roadmap](docs/ROADMAP.md)
- [Architecture Guide](docs/ARCHITECTURE.md)
- [Core API Reference](docs/API_REFERENCE.md)
- [Contributing Guide](CONTRIBUTING.md)
- [Community Discussions](https://github.com/irzix/nestjs-agentic/discussions)

Runnable examples are available in [`examples`](examples).

## Sponsorship & Support

`nestjs-agentic` is an open-source framework dedicated to production-grade, governed AI agent systems in NestJS. If you or your organization find value in the project, consider supporting ongoing development:

- 💖 **[Sponsor on GitHub](https://github.com/sponsors/irzix)**
- ⭐ Star the repository on GitHub
- 🤝 [Contribute](CONTRIBUTING.md) features, adapters, and improvements

## License

[MIT](LICENSE) © [irzix](https://github.com/irzix)
