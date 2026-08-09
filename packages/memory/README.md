# @nestjs-agentic/memory

Multi-tier cognitive memory module for **nestjs-agentic**. Provides Short-Term Sliding-Window Memory, Working Scratchpad Memory, and Composite Memory Stores across all LLM runtime adapters.

---

## Installation

```bash
npm install @nestjs-agentic/memory nestjs-agentic
```

---

## Features & Memory Stores

1. **`ShortTermMemory`**: Sliding-window conversation history per `sessionId` with configurable message caps (`maxMessages`).
2. **`ScratchpadMemory`**: Active working task and active file memory buffer for agent execution.
3. **`CompositeMemory`**: Unified memory store combining multiple memory tiers under a single `AgentMemoryStore` interface.

---

## Usage Example

```typescript
import { ShortTermMemory, ScratchpadMemory, CompositeMemory } from '@nestjs-agentic/memory';

const shortTerm = new ShortTermMemory({ maxMessages: 10 });
const scratchpad = new ScratchpadMemory();

const memory = new CompositeMemory([shortTerm, scratchpad]);

// Save record
await memory.save({
  id: 'rec_1',
  sessionId: 'sess_1001',
  type: 'short_term',
  content: 'User prefers dark mode UI theme',
});

// Recall query across all memory tiers
const results = await memory.recall('dark mode', { sessionId: 'sess_1001' });
```

---

## License

[MIT](LICENSE) © [irzix](https://github.com/irzix)
