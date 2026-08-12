# @nestjs-agentic/langgraph

Experimental LangChain/LangGraph compatibility package for the NestJS-native runtime for governed AI agents.

## Status and Compatibility Scope

**Experimental:** this adapter is intended for evaluation of type compatibility and governed tool wrapping. It is not a complete LangGraph agent runtime.

The current implementation:

- wraps `ResolvedTool` closures as LangChain tools;
- accepts a LangChain model and LangGraph `BaseCheckpointSaver` types;
- does not build, compile, or execute a LangGraph `StateGraph`;
- invokes a configured model once and does not execute returned tool calls or run a model/tool loop;
- uses a synthetic fallback when no model is configured, directly invoking tools with generated test arguments;
- exposes synthetic tool events from `stream()` rather than model or graph token streaming; and
- does not provide unified durable recovery through core execution state.

The fallback and stream paths can invoke application tools with generated arguments that do not match the user request or tool schema. Do not use this adapter with production side effects.

## Installation

```bash
npm install @nestjs-agentic/langgraph @langchain/core @langchain/langgraph
```

## Model Compatibility Path

Pass a configured instance explicitly to select the current single-invoke model path:

```typescript
import { Module } from '@nestjs/common';
import { MemorySaver } from '@langchain/langgraph';
import { AgenticModule, RUNTIME_ADAPTER } from 'nestjs-agentic';
import { LangGraphRuntimeAdapter } from '@nestjs-agentic/langgraph';

@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel: { provider: 'custom', model: 'configured-chat-model' },
    }),
  ],
  providers: [
    {
      provide: RUNTIME_ADAPTER,
      useFactory: () => new LangGraphRuntimeAdapter({
        model,
        checkpointer: new MemorySaver(),
      }),
    },
  ],
})
export class AppModule {}
```

This registration binds tools to one model invocation. It does not add graph nodes, conditional edges, tool-call execution, or a second model round.

## Checkpointer Scope

When no model is supplied, the fallback path can write a synthetic checkpoint through the configured saver. This is not equivalent to a compiled graph checkpoint or durable `AgentRunner` recovery. The model path and `stream()` do not currently provide the same checkpoint behavior.

Use `MockRuntimeAdapter` for deterministic tool and policy tests. See the [product roadmap](https://github.com/irzix/nestjs-agentic/blob/main/docs/ROADMAP.md) for planned common runtime semantics.

## License

[MIT](https://github.com/irzix/nestjs-agentic/blob/main/LICENSE) © [irzix](https://github.com/irzix)
