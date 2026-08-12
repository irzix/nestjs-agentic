# LangGraph Compatibility Example (`example-langgraph-workflow`)

A deterministic evaluation example for the experimental `@nestjs-agentic/langgraph` compatibility adapter and NestJS-governed tool closures. It is not a production workflow or a complete LangGraph agent.

## Current Scope

- `LangGraphRuntimeAdapter` wraps `ResolvedTool` closures so policy evaluation and bound `@Context()` values remain at the tool boundary.
- The example registers the adapter without a model, selecting its synthetic fallback path.
- The fallback directly invokes tools with generated test arguments and can record a synthetic checkpoint.
- The adapter does not build or compile a `StateGraph`.
- Its configured-model path is a single model invocation without a tool-call loop.
- Its stream events are synthetic and are not model or graph token streaming.

Because fallback and stream paths can invoke tools with generated arguments, do not use this example with production side effects.

## Structure

```text
examples/langgraph-workflow/
├── src/
│   ├── agent/inventory.agent.ts
│   ├── policies/inventory-access.policy.ts
│   ├── tools/inventory.tools.ts
│   ├── app.module.ts
│   └── test-langgraph.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Run the Evaluation Tests

```bash
npm test
```

The tests exercise the current no-model fallback behavior, policy decisions, and context binding. They do not validate `StateGraph` execution, a model/tool loop, durable recovery, or production isolation.

## Adapter Registration Used by the Example

```typescript
import { Module } from '@nestjs/common';
import { AgenticModule, RUNTIME_ADAPTER } from '@nestjs-agentic/core';
import { LangGraphRuntimeAdapter } from '@nestjs-agentic/langgraph';
import { InventoryAgent } from './agent/inventory.agent';
import { InventoryAccessPolicy } from './policies/inventory-access.policy';
import { InventoryTools } from './tools/inventory.tools';

@Module({
  imports: [
    AgenticModule.forRoot({
      defaultModel: { provider: 'mock', model: 'compatibility-evaluation' },
    }),
    AgenticModule.forFeature({
      agents: [InventoryAgent],
      toolSets: [InventoryTools],
      policies: [InventoryAccessPolicy],
    }),
  ],
  providers: [
    { provide: RUNTIME_ADAPTER, useClass: LangGraphRuntimeAdapter },
  ],
})
export class AppModule {}
```
