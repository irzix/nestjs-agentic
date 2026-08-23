---
'@nestjs-agentic/rag': minor
---

`RAGPipeline.executePipeline()` discarded each chunk's retrieval score, so `RAGContext.scores` was always empty. `RerankerStrategy` and `UShapedContextStrategy` read `context.scores` when present but always fell back to their own term-overlap heuristics, and `GraphRAGStrategy`/`GraphDependencyStrategy` boosted from a uniform `1.0` baseline instead of the real score.

- Added `VectorStoreAdapter.searchChunksScored` (optional) and `ScoredDocumentChunk`. `HybridVectorStore` implements it, returning each chunk with its fused BM25+cosine score.
- Added `KnowledgeBase.queryChunksScored`, using the adapter's real score when available and falling back to a synthetic rank-based score (`1 / (rank + 1)`) for adapters that don't implement it, so callers always get a usable score.
- `RAGPipeline` now populates `ctx.scores` during retrieval, taking the max score across expanded-query variants for chunks matched by more than one.
- `HybridVectorStore.search()` (the `SemanticStoreProvider` integration used by `@nestjs-agentic/memory`) no longer hardcodes `score: 1.0`; it returns the real fused score.

This is the prerequisite for a real Reciprocal Rank Fusion strategy and any reranker that blends its score with the original retrieval score, both tracked separately.
