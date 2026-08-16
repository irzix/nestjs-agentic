# Task 02: AST Codebase RAG & Hybrid Search Pipeline

> **Implementation specification for AST-Aware Code Chunking, PostgreSQL pgvector Storage, RRF Hybrid Search, and GraphRAG.**

---

## 🎯 Objective
Build the codebase knowledge ingestion and retrieval subsystem that parses TypeScript AST structures, manages hybrid vector and full-text indexes in PostgreSQL, performs Reciprocal Rank Fusion (RRF), and traces package import dependencies.

---

## 📁 Target Files to Create
* `src/ingestion/ast-splitter.ts`
* `src/stores/postgres-codebase.store.ts`
* `src/rag/rag-pipeline.service.ts`
* `src/rag/strategies/query-expansion.strategy.ts`
* `src/rag/strategies/parent-child-hydration.strategy.ts`
* `src/rag/strategies/graph-dependency.strategy.ts`
* `src/rag/reranker/cross-encoder.reranker.ts`

---

## 📋 Detailed Technical Requirements

### 1. AST-Aware TypeScript Splitter (`src/ingestion/ast-splitter.ts`)
* Use `ts-morph` to extract `InterfaceDeclaration`, `ClassDeclaration`, and `MethodDeclaration`.
* Preserve symbol names, line number boundaries (`startLine`, `endLine`), and constructor dependency types.
* Output structured `CodebaseChunk[]` objects without breaking syntactic scopes.

### 2. PostgreSQL Storage Schema (`src/stores/postgres-codebase.store.ts`)
* Initialize `codebase_chunks` table with `vector(1536)` embedding column.
* Create `HNSW` index with `vector_cosine_ops` for fast dense nearest-neighbor search.
* Create `GIN` index on `to_tsvector('english', content)` for sparse keyword matching.
* Implement batch upsert and chunk deletion on file modifications.

### 3. Hybrid RAG Pipeline (`src/rag/rag-pipeline.service.ts`)
* Implement **Query Expansion:** Expand PR abbreviations (e.g. `policy` ➔ `governance, guard, checkpoint`).
* Implement **Reciprocal Rank Fusion (RRF):** Combine dense and sparse candidate ranks:
  $$RRF(d) = \sum_{m \in \{\text{Dense}, \text{BM25}\}} \frac{1}{60 + r_m(d)}$$
* Implement **Parent-Child Hydration:** Hydrate method chunks to their parent class context.
* Implement **Cross-Encoder Reranker:** Re-rank top 20 candidate chunks down to top 4 highest-scoring chunks.

### 4. GraphRAG Dependency Strategy (`src/rag/strategies/graph-dependency.strategy.ts`)
* Query SQL array dependencies (`WHERE $1 = ANY(dependencies)`) to identify which downstream packages import a modified symbol.

---

## ✅ Acceptance Criteria & Testing
1. AST Splitter correctly parses complex TypeScript files with classes, decorators, and generic interfaces.
2. Hybrid search successfully retrieves both exact variable names (e.g. `IdempotencyStore`) and conceptual queries.
3. GraphRAG dependency query returns all files importing a targeted interface.
4. Unit tests pass: `npm run test:unit -- src/ingestion/ast-splitter.spec.ts src/rag`
