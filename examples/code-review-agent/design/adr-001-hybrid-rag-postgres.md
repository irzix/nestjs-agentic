# ADR 001: Hybrid RAG Architecture with PostgreSQL, pgvector, and AST Chunking

## Status
**ACCEPTED** (2026-08-16)

---

## Context & Problem Statement
Njent requires a knowledge retrieval engine to ground pull request reviews against the repository's architectural standards, design guidelines, and existing type definitions. 

Source code is structurally different from natural language prose:
1. Standard line/character-based chunking breaks syntactic scopes (classes, interfaces, and methods), causing severe hallucinations.
2. Dense vector search alone struggles to locate exact TypeScript type names, variable identifiers, and specific error codes.
3. Managing external specialized vector databases (e.g. Pinecone, Qdrant, Milvus) introduces operational complexity and cost overhead for a NestJS monorepo.

---

## Decision
We choose **PostgreSQL with `pgvector` and Full-Text Search (GIN `tsvector`)** combined with **AST-Aware TypeScript Chunking (`ts-morph`)** and **Reciprocal Rank Fusion (RRF)** as the core knowledge retrieval engine.

```
                  ┌──────────────────────────────────────────────┐
                  │          Codebase Ingestion Engine           │
                  └──────────────────────┬───────────────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
       ┌────────────────────────┐                  ┌────────────────────────┐
       │   AST-Aware Chunker    │                  │  Parent-Child Builder  │
       │ (ts-morph Class/Iface) │                  │  (Method ➔ Class Map)  │
       └───────────┬────────────┘                  └───────────┬────────────┘
                   │                                           │
                   └─────────────────────┬─────────────────────┘
                                         ▼
                      ┌────────────────────────────────────┐
                      │    PostgreSQL + pgvector Store     │
                      ├──────────────────┬─────────────────┤
                      │ HNSW Vector (1536)│ GIN tsvector FTS│
                      └─────────┬────────┴────────┬────────┘
                                │                 │
               Dense Semantic ──┘                 └── Sparse Lexical
                                ╲                 ╱
                                 ▼               ▼
                              ┌─────────────────────┐
                              │  Hybrid RRF Fusion  │
                              └──────────┬──────────┘
                                         ▼
                              ┌─────────────────────┐
                              │ Cross-Encoder Ranker│
                              └─────────────────────┘
```

### Key Technical Choices:
1. **AST-Aware Chunking:** Uses `ts-morph` to parse TypeScript source files into discrete semantic units (`interface`, `class`, `method`).
2. **Parent-Child Hierarchy:** Methods are indexed as individual vectors for high-precision matching, but hydrate to their complete parent class definition upon retrieval.
3. **Hybrid Search with RRF:** Dense cosine distance (`vector_cosine_ops` with `HNSW` index) is combined with BM25 lexical ranking (`to_tsvector('english', content)` with `GIN` index) using Reciprocal Rank Fusion:
   $$RRF(d) = \sum_{m \in \{\text{Vector}, \text{BM25}\}} \frac{1}{k + r_m(d)} \quad (k = 60)$$
4. **Graph-RAG Dependency Tracing:** The `codebase_chunks` table includes a `dependencies TEXT[]` column, allowing SQL array containment queries (`WHERE $1 = ANY(dependencies)`) to trace cross-package import graphs.
5. **Cross-Encoder Reranking:** Top 20 candidate chunks are scored via a cross-encoder model to prune 80% of irrelevant tokens before prompt injection.

---

## Alternatives Considered

| Alternative | Advantages | Disadvantages / Rejection Reason |
|---|---|---|
| **External Vector DB (Pinecone / Qdrant)** | Managed scaling; built-in hybrid search. | High SaaS cost; requires external API keys; lacks direct relational join with repository audit tables. |
| **In-Memory Vector Store (Chroma / MemoryVectorStore)** | Zero setup for testing. | Loses state across server restarts; unviable for enterprise production persistence. |
| **Pure Naive Vector Search (No BM25/AST)** | Simple text chunking. | Fails on exact symbol names (e.g. `IdempotencyStore`); breaks TypeScript syntax scopes. |

---

## Consequences & Trade-offs
* **Positive:** Complete syntax integrity; finds both conceptual ideas and exact symbol names; zero extra database infrastructure (reuses PostgreSQL).
* **Negative:** Requires AST parsing step during repository ingestion on merge; PostgreSQL requires `vector` extension installed.
