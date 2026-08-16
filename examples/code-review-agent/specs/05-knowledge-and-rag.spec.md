# 05 — Knowledge & RAG Specification
> **Comprehensive specification of all RAG Strategies, Chunking, Retrieval, Reranking, Graph-RAG, and Optimizations in Njent.**

---

## 📚 Academic & Research Foundations
* **Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks** — *Lewis et al., Meta AI (NeurIPS 2020)* ([arXiv:2005.11401](https://arxiv.org/abs/2005.11401)).
* **From Local to Global: A Graph RAG Approach to Query-Focused Summarization** — *Edge et al., Microsoft Research (2024)* ([arXiv:2404.16130](https://arxiv.org/abs/2404.16130)).

---

## 1. Concrete Mapping of All 7 RAG Concepts in Njent

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   NJENT RAG ARCHITECTURE                               │
├───────────────────────────┬────────────────────────────────────────────────────────────┤
│ 1. How RAG Works          │ • 2-Phase Pipeline: Ingestion on Merge ➔ Hybrid Query on PR │
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 2. RAG Strategies         │ • Modular RAG Pipeline combining AST, Hybrid Search & Graph│
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 3. Chunking Strategies    │ • AST-Aware Chunking (Classes, Interfaces, Methods)        │
│                           │ • Markdown Hierarchy Chunking (Roadmap & Guidelines)       │
│                           │ • Late Chunking (Embedding full file before chunk split)   │
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 4. Retrieval Strategies   │ • Dense Vector Search (pgvector HNSW Cosine Distance)      │
│                           │ • Sparse Keyword Search (PostgreSQL GIN tsvector BM25)     │
│                           │ • Hybrid RRF (Reciprocal Rank Fusion)                      │
│                           │ • Parent-Child Hydration (Match method ➔ Hydrate class)    │
│                           │ • Graph-RAG (Tracing package imports & interface relations)│
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 5. Reranking              │ • Cross-Encoder Reranker (Top-20 candidates ➔ Top-4 chunks)│
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 6. RAG Trade-offs         │ • Precision vs. Recall & Latency vs. Token Cost analysis   │
├───────────────────────────┼────────────────────────────────────────────────────────────┤
│ 7. RAG Optimization       │ • Query Expansion (Synonyms & technical symbol expansions) │
│                           │ • Contextual Compression (Pruning bodies, preserving types)│
│                           │ • Metadata Scoping (Package & tenant isolation filters)    │
└───────────────────────────┴────────────────────────────────────────────────────────────┘
```

---

## 2. Technical Specification & Implementation Details

### 2.1 Chunking Strategies Implementation

#### A. AST-Aware TypeScript Chunker (`src/ingestion/ast-splitter.ts`)
```typescript
import { Project, SyntaxKind, ClassDeclaration, InterfaceDeclaration } from 'ts-morph';

export interface CodebaseChunk {
  id: string;
  filePath: string;
  packageName: string;
  chunkType: 'class' | 'interface' | 'method' | 'doc';
  symbolName: string;
  parentSymbol?: string;
  content: string;
  startLine: number;
  endLine: number;
  dependencies: string[]; // For Graph-RAG
}

export class ASTCodebaseSplitter {
  static splitTypeScriptFile(filePath: string, sourceCode: string): CodebaseChunk[] {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(filePath, sourceCode);
    const chunks: CodebaseChunk[] = [];

    // 1. Extract Interfaces
    sourceFile.getInterfaces().forEach((iface) => {
      chunks.push({
        id: `${filePath}#${iface.getName()}`,
        filePath,
        packageName: filePath.split('/')[1] || 'core',
        chunkType: 'interface',
        symbolName: iface.getName(),
        content: iface.getText(),
        startLine: iface.getStartLineNumber(),
        endLine: iface.getEndLineNumber(),
        dependencies: [],
      });
    });

    // 2. Extract Classes & Parent-Child Methods
    sourceFile.getClasses().forEach((cls) => {
      const className = cls.getName() || 'AnonymousClass';
      
      // Parent Chunk: Class header + Constructor + Injected Dependencies
      chunks.push({
        id: `${filePath}#${className}`,
        filePath,
        packageName: filePath.split('/')[1] || 'core',
        chunkType: 'class',
        symbolName: className,
        content: cls.getText(),
        startLine: cls.getStartLineNumber(),
        endLine: cls.getEndLineNumber(),
        dependencies: cls.getConstructors()[0]?.getParameters().map(p => p.getType().getText()) || [],
      });
    });

    return chunks;
  }
}
```

---

### 2.2 Storage & Hybrid Search Schema (PostgreSQL + pgvector)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE codebase_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_path VARCHAR(500) NOT NULL,
    package_name VARCHAR(100) NOT NULL,
    chunk_type VARCHAR(50) NOT NULL,
    symbol_name VARCHAR(250) NOT NULL,
    parent_symbol VARCHAR(250),
    dependencies TEXT[] DEFAULT '{}',
    start_line INT NOT NULL,
    end_line INT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_chunks_hnsw ON codebase_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_chunks_fts ON codebase_chunks USING gin (to_tsvector('english', content));
```

---

### 2.3 Retrieval Strategies & Pipeline

```typescript
import { Injectable } from '@nestjs/common';
import {
  KnowledgeBase,
  RAGPipeline,
  QueryExpansionStrategy,
  ParentChildHydrationStrategy,
  ContextualCompressionStrategy,
} from '@nestjs-agentic/rag';
import { PostgresCodebaseStore } from '../stores/postgres-codebase.store';

@Injectable()
export class NjentRAGPipeline {
  private pipeline: RAGPipeline;

  constructor(private readonly store: PostgresCodebaseStore) {
    this.pipeline = new RAGPipeline({
      knowledgeBase: new KnowledgeBase({ vectorStore: store.getVectorStoreAdapter() }),
      strategies: [
        // 1. Query Expansion
        new QueryExpansionStrategy({
          synonymsMap: {
            policy: ['governance', 'guard', 'approval', 'checkpoint'],
            runner: ['executor', 'orchestrator', 'delegator'],
          },
        }),
        // 2. Parent-Child Hydration (Hydrates method matches to their parent class)
        new ParentChildHydrationStrategy({ store: this.store }),
        // 3. Contextual Compression (Prunes large bodies, keeps type signatures)
        new ContextualCompressionStrategy({ maxCharacters: 1800, preserveSignaturesOnly: true }),
      ],
    });
  }

  // Hybrid Search Formula: Reciprocal Rank Fusion (RRF)
  async executeHybridSearch(query: string, limit = 5): Promise<string> {
    return this.pipeline.executePipeline(query, limit);
  }

  // Graph-RAG: Traces dependencies across packages
  async traceDependencyGraph(symbolName: string): Promise<string[]> {
    const rows = await this.store.query(
      `SELECT file_path, symbol_name, dependencies 
       FROM codebase_chunks 
       WHERE $1 = ANY(dependencies)`,
      [symbolName]
    );
    return rows.map(r => `• Symbol "${symbolName}" is imported and used in: ${r.file_path} (${r.symbol_name})`);
  }
}
```

---

### 2.4 Reranking Strategy (Cross-Encoder)
After hybrid retrieval returns 20 candidate chunks, a cross-encoder scores token-pair interactions:
$$Score(Query, Chunk) = \text{Softmax}(W \cdot \text{BERT}(Query \oplus Chunk))$$
The top-4 highest-scoring chunks are injected into the active prompt window, discarding the remaining 16 noisy chunks.

---

## 3. RAG Trade-offs & Production Engineering

| Strategy | Advantages | Trade-offs / Costs |
|---|---|---|
| **AST Chunking vs. Fixed Split** | Zero syntax destruction; complete function semantics. | Requires TypeScript AST parser (`ts-morph`). |
| **Hybrid Search (Vector + BM25)** | Finds both conceptual ideas and exact variable/symbol names. | Requires managing two indexes (`HNSW` + `GIN`) in PostgreSQL. |
| **Parent-Child Hydration** | High retrieval precision with full class context. | Consumes slightly more prompt tokens upon hydration. |
| **Graph-RAG** | Discovers breaking changes in downstream consumer packages. | Requires traversing dependency arrays in SQL. |
| **Cross-Encoder Reranking** | Eliminates 80% of irrelevant tokens; boosts accuracy. | Adds ~80–120ms to the retrieval stage. |
