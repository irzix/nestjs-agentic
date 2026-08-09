# @nestjs-agentic/langgraph

LangGraph Runtime Adapter for **nestjs-agentic**. Connects LangGraph stateful multi-agent workflows and LangChain models to NestJS governance pipelines.

## Installation

```bash
npm install @nestjs-agentic/langgraph @langchain/core @langchain/langgraph
```

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
