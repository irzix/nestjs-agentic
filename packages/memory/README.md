# @nestjs-agentic/memory

Experimental, opt-in memory primitives for the NestJS-native runtime for governed AI agents.

This package provides explicitly constructed memory stores. It is not automatically attached to `AgentRunner`, and the framework does not automatically save, recall, or recover agent execution through these stores. Applications choose when to write records and when to add recalled context to a run.

## Status

**Experimental:** available for evaluation and feedback, but not yet part of a unified durable execution lifecycle.

## Installation

```bash
npm install @nestjs-agentic/memory nestjs-agentic
```

## Memory Stores

- `ShortTermMemory`: sliding-window records per `sessionId`.
- `ScratchpadMemory`: working records for an application-managed task.
- `SemanticMemory`: semantic recall backed by the default basic store or a supplied `SemanticStoreProvider`.
- `EpisodicMemory`: application-managed episodic records.
- `CompositeMemory`: combines explicitly supplied stores behind `AgentMemoryStore`.

## Usage

```typescript
import {
  CompositeMemory,
  ScratchpadMemory,
  ShortTermMemory,
} from '@nestjs-agentic/memory';

const memory = new CompositeMemory([
  new ShortTermMemory({ maxMessages: 10 }),
  new ScratchpadMemory(),
]);

await memory.save({
  id: 'rec_1',
  sessionId: 'sess_1001',
  type: 'short_term',
  content: 'User prefers dark mode.',
});

const results = await memory.recall('dark mode', {
  sessionId: 'sess_1001',
  limit: 5,
});
```

Integrate `results` into your application or agent input explicitly. Do not treat these process-level primitives as durable execution checkpoints.

## License

[MIT](https://github.com/irzix/nestjs-agentic/blob/main/LICENSE) © [irzix](https://github.com/irzix)
