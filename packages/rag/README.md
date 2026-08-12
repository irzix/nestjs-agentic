# @nestjs-agentic/rag

Experimental, opt-in retrieval primitives for the NestJS-native runtime for governed AI agents. The package provides a modular `KnowledgeBase`, an in-memory `HybridVectorStore`, retrieval strategies, and knowledge-graph abstractions for evaluation and application-directed integration.

It is not automatically attached to `AgentRunner`. Applications own ingestion, retrieval, authorization, persistence, embedding providers, and prompt assembly.

## Status

**Experimental:** APIs are published for evaluation and feedback but do not yet carry production guarantees for durability, isolation, retries, or observability.

## Installation

```bash
npm install @nestjs-agentic/rag @nestjs-agentic/memory nestjs-agentic
```

## Included Primitives

- `KnowledgeBase` for splitting, indexing, and querying documents.
- `HybridVectorStore` for in-memory sparse keyword and optional dense-vector scoring.
- `RAGPipeline` for pre- and post-retrieval strategies.
- Query expansion, parent-child hydration, reranking, late chunking, contextual compression, and graph strategies.
- `VectorStoreAdapter` and `VectorStoreFactory` hooks for application-provided storage integrations.
- `SemanticStoreProvider` compatibility for explicit use with `@nestjs-agentic/memory`.

The package does not include a built-in Prisma or production pgvector persistence layer. Custom factory adapters delegate storage behavior to application callbacks.

## Quick Start

```typescript
import {
  ContextualCompressionStrategy,
  HybridVectorStore,
  KnowledgeBase,
  QueryExpansionStrategy,
  RAGPipeline,
} from '@nestjs-agentic/rag';

const store = new HybridVectorStore({ embeddingProvider });
const knowledgeBase = new KnowledgeBase({ vectorStore: store });

await knowledgeBase.ingestDocument({
  title: 'Financial Transfer Policy',
  rawContent: 'Transfers above $10,000 require finance officer approval.',
  metadata: { tenantId: 'acme' },
});

const pipeline = new RAGPipeline({
  knowledgeBase,
  strategies: [
    new QueryExpansionStrategy({
      synonymsMap: { wire: ['transfer', 'payment'] },
    }),
    new ContextualCompressionStrategy({ maxCharacters: 1500 }),
  ],
});

const context = await pipeline.executePipeline(
  'wire transfer limits',
  5,
  { tenantId: 'acme' },
);
```

`ContextualCompressionStrategy` performs local extractive filtering; it does not imply a latency guarantee.

## Metadata Filters and Isolation

```typescript
const chunks = await knowledgeBase.queryChunks(
  'wire transfer',
  5,
  { tenantId: 'acme' },
);
```

Metadata filtering scopes retrieval only when the selected store adapter honors those filters. Applications and databases must still enforce authorization and hard tenant isolation.

## Custom Stores

`VectorStoreFactory` exposes adapter hooks; it does not provide or configure your database:

```typescript
import { VectorStoreFactory } from '@nestjs-agentic/rag';

const vectorStore = VectorStoreFactory.createCustom({
  addChunksFn: (chunks) => vectorStoreService.upsert(chunks),
  searchFn: async (query, limit, filter) => {
    const vector = await embeddingProvider.embedQuery(query);
    return vectorStoreService.search(vector, limit, filter);
  },
});
```

## Optional Memory Integration

```typescript
import { SemanticMemory } from '@nestjs-agentic/memory';
import { HybridVectorStore } from '@nestjs-agentic/rag';

const vectorStore = new HybridVectorStore({ embeddingProvider });
const semanticMemory = new SemanticMemory({ provider: vectorStore });

await semanticMemory.save({
  id: 'fact_1',
  sessionId: 'sess_101',
  type: 'semantic',
  content: 'Acme requires approval for high-value transfers.',
});

const facts = await semanticMemory.recall('transfer approval', {
  sessionId: 'sess_101',
});
```

This integration is application-managed and is not automatically connected to `AgentRunner`.

## License

[MIT](https://github.com/irzix/nestjs-agentic/blob/main/LICENSE) © [irzix](https://github.com/irzix)
