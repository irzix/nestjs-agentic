# @nestjs-agentic/langgraph

LangGraph Runtime Adapter for **nestjs-agentic**. Connects LangGraph stateful graph workflows, Checkpointer thread persistence (`MemorySaver`, `SqliteSaver`, `PostgresSaver`), and LangChain ChatModels directly to NestJS governance pipelines.

---

## Installation

```bash
npm install @nestjs-agentic/langgraph @langchain/core @langchain/langgraph
```

---

## Key Features

1. **Stateful Checkpointer Persistence**: Saves graph thread state per `sessionId` via `BaseCheckpointSaver` (defaults to `MemorySaver`).
2. **NestJS Policy Guarded Tools**: Automatically wraps NestJS `@ToolSet` methods into LangChain `tool()` closures with policy evaluation and `@Context()` pre-binding.
3. **Structured Event Streaming**: Supports `runner.runStream()` emitting `tool_start`, `tool_result`, `approval_required`, and `token` events.

---

## Quick Start

Register `LangGraphRuntimeAdapter` in your NestJS `AppModule`:

```typescript
import { Module } from '@nestjs/common';
import { AgenticModule, RUNTIME_ADAPTER } from 'nestjs-agentic';
import { LangGraphRuntimeAdapter } from '@nestjs-agentic/langgraph';

@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel: { provider: 'openai', model: 'gpt-4o' },
    }),
  ],
  providers: [
    {
      provide: RUNTIME_ADAPTER,
      useClass: LangGraphRuntimeAdapter,
    },
  ],
})
export class AppModule {}
```

---

## Using Custom Checkpointer (e.g. MemorySaver / SqliteSaver)

```typescript
import { MemorySaver } from '@langchain/langgraph';
import { LangGraphRuntimeAdapter } from '@nestjs-agentic/langgraph';

const checkpointer = new MemorySaver();

const adapter = new LangGraphRuntimeAdapter({
  checkpointer,
  enableCheckpointer: true,
});
```

---

## License

[MIT](LICENSE) © [irzix](https://github.com/irzix)
