# @nestjs-agentic/rag

## 1.3.0

### Minor Changes

- ca8518f: Add `PromptInjectionSanitizer` (`@nestjs-agentic/core`), a utility that strips known chat-template/role-delimiter injection vectors (`<|im_start|>`, `[INST]`, `<system>`, `Human:`, etc.) and wraps untrusted content in explicit XML boundary tags, plus `PromptInjectionSanitizationPolicy`, a built-in Output Rail applying it to tool output automatically.

  `@nestjs-agentic/rag`'s `UShapedContextStrategy` and `ContextualCompressionStrategy` now wrap retrieved chunk content in a `<retrieved_chunk>` boundary and sanitize it before writing `compressedContext`, mitigating indirect prompt injection via poisoned documents. Closes #136.

### Patch Changes

- Updated dependencies [eb84976]
- Updated dependencies [ca8518f]
  - @nestjs-agentic/core@1.3.0
  - @nestjs-agentic/memory@1.3.0

## 1.2.0

### Minor Changes

- 360d862: Add `CachedEmbeddingProvider`, an `EmbeddingProvider` decorator that caches embeddings by a content hash (namespaced by `cacheNamespace`), using an in-memory LRU cache by default or a pluggable `StateStore` (e.g. Redis) backend. Closes #134.
- 48b3acf: Add `MmrStrategy`, a post-retrieval Maximal Marginal Relevance diversity strategy that reduces near-duplicate chunks in retrieved context. Extract `cosineSimilarity` as a shared utility, used by both `MmrStrategy` and `HybridVectorStore`. Closes #133.
- 76abfe5: Add `createCohereRerankProvider` and `createVoyageRerankProvider` built-in `RerankFunction` factories for `RerankerStrategy`. Add `RerankerStrategyOptions.minScore` to drop low-relevance chunks post-rerank, and `onRerankFailure`/`onRerankFailureMode` ('fallback' | 'throw') to make `rerankFn` failures observable instead of silently degrading to term-overlap scoring. Closes #132.
- d1e6079: Add real Reciprocal Rank Fusion (RRF) support to `HybridVectorStore` via a new `fusionMethod: 'weighted' | 'rrf'` option (default `'weighted'`, preserving existing behavior), plus a standalone `reciprocalRankFusion` utility for fusing any ranked id lists (e.g. RAG-Fusion-style multi-query variants). Closes #130.

### Patch Changes

- @nestjs-agentic/memory@1.2.0

## 1.1.0

### Minor Changes

- a42c6c2: `RAGPipeline.executePipeline()` discarded each chunk's retrieval score, so `RAGContext.scores` was always empty. `RerankerStrategy` and `UShapedContextStrategy` read `context.scores` when present but always fell back to their own term-overlap heuristics, and `GraphRAGStrategy`/`GraphDependencyStrategy` boosted from a uniform `1.0` baseline instead of the real score.

  - Added `VectorStoreAdapter.searchChunksScored` (optional) and `ScoredDocumentChunk`. `HybridVectorStore` implements it, returning each chunk with its fused BM25+cosine score.
  - Added `KnowledgeBase.queryChunksScored`, using the adapter's real score when available and falling back to a synthetic rank-based score (`1 / (rank + 1)`) for adapters that don't implement it, so callers always get a usable score.
  - `RAGPipeline` now populates `ctx.scores` during retrieval, taking the max score across expanded-query variants for chunks matched by more than one.
  - `HybridVectorStore.search()` (the `SemanticStoreProvider` integration used by `@nestjs-agentic/memory`) no longer hardcodes `score: 1.0`; it returns the real fused score.

  This is the prerequisite for a real Reciprocal Rank Fusion strategy and any reranker that blends its score with the original retrieval score, both tracked separately.

### Patch Changes

- 6a87bb2: Fix `HybridVectorStore.addChunks` issuing one `embedQuery` call per unembedded chunk instead of using the batch `embedDocuments` API `EmbeddingProvider` already defines. Ingesting a codebase with hundreds of AST-split chunks meant hundreds of concurrent HTTP requests instead of a handful of batched ones — worse latency, worse cost, and more likely to trip provider rate limits.

  - `addChunks` now embeds unembedded chunks via `embedDocuments()`, chunked into groups of a new `embeddingBatchSize` option (default `100`) so a single call for an unbounded number of chunks doesn't exceed a provider's per-request size limit.
  - `embeddingBatchSize` is validated at construction: zero, negative, fractional, `NaN`, or `Infinity` values throw a `RangeError` instead of causing `addChunks` to hang in an infinite loop (a batch size of `0` or negative left the loop index unchanged forever).
  - An `embedDocuments` response whose length doesn't match the requested batch size now throws instead of silently attaching misaligned or `undefined` embeddings to chunks.
  - Confirmed and documented that mutating the input `DocumentChunk` objects in place (to attach the generated `embedding`) is intentional: `KnowledgeBase.ingestDocument` passes the same array it keeps a reference to and relies on seeing the embedding on it afterward.
  - Added regression tests proving a batch of 7 chunks issues exactly one `embedDocuments` call (not 7 `embedQuery` calls), that a batch larger than `embeddingBatchSize` splits into the correct number of batched calls, that invalid batch sizes are rejected at construction, and that a mismatched embedding response is rejected rather than applied.

  An embedding cache (in-memory LRU with a pluggable Redis backend) remains tracked separately as forward work in issue #134.

- a8964d7: Fix `HybridVectorStore`'s sparse score computing plain term frequency (`matchCount / tokens.length`) despite being named/documented as BM25. It had no IDF term and no `k1`/`b` saturation, so it couldn't down-weight common words or up-weight rare, distinctive terms — the entire point of BM25 for code/text hybrid search.

  - `HybridVectorStore` now maintains incremental corpus-level statistics (per-term document frequency, total token count) on `addChunks` (including upsert), `deleteChunk`, and `clear`, and computes real BM25 (Robertson/Sparck-Jones formula) at query time.
  - Added `bm25K1` (term-frequency saturation, default `1.2`) and `bm25B` (document-length normalization, default `0.75`) constructor options with standard defaults.
  - Existing `vectorWeight` fusion behavior (max-normalized weighted sum with the dense cosine score) is unchanged — this only replaces the sparse score's own computation.
  - Added a regression test proving a chunk containing a rare, distinctive term outranks a chunk that merely repeats a common term many times — the opposite of what the previous term-frequency-only formula would have ranked.

  Updated `docs/ARCHITECTURE.md` and `apps/landing/content/docs/rag/hybrid-vector-store.mdx` to describe the real BM25 formula instead of the tracked-as-future-work placeholder text.

  - @nestjs-agentic/memory@1.1.0

## 0.7.0

### Minor Changes

- e58e49c: Comprehensive Milestone 0.8 ecosystem adapters, GraphRAG, Stanford cognitive memory, FrugalGPT model cascading, and position-debiased evaluation:

  - **@nestjs-agentic/mcp**: Native Model Context Protocol client transport, tool discovery, authorization, and secure tool invocation over Stdio and SSE.
  - **@nestjs-agentic/core**: FrugalGPT confidence-threshold model cascading (`ModelCascadeAdapter`, `ModelCascadeRouter`), prompt attention formatting (`UCurveContextFormatter`), and wall-clock execution duration metrics (`durationMs`).
  - **@nestjs-agentic/memory**: Stanford University Tri-Factor cognitive memory scoring (`StanfordMemoryScorer`), Procedural SOP playbooks (`ProceduralMemoryStore`), and cognitive reflection learning (`ReflectionEngine`, `ExperienceLearner`).
  - **@nestjs-agentic/rag**: AST-aware codebase semantic chunking (`AstCodebaseSplitter`), GraphRAG relational dependency traversal (`GraphRAGStrategy`, `GraphDependencyStrategy`), and U-Shaped attention distribution (`UShapedContextStrategy`).
  - **@nestjs-agentic/evaluation**: Pairwise position-swap debiased judge (`PairwiseDebiasedJudge`, `runPairwiseDebiasedJudge`), Trajectory step efficiency (`TrajectoryInspectorMetric`), and Tool execution precision (`ToolPrecisionMetric`).
  - **@nestjs-agentic/openai**: Full contract-tested OpenAI and ChatCompletions model adapter with streaming, reasoning token limits, and client injection.

### Patch Changes

- Updated dependencies [e58e49c]
  - @nestjs-agentic/memory@0.7.0

## 0.6.0

### Patch Changes

- @nestjs-agentic/memory@0.6.0

## 0.5.0

### Patch Changes

- @nestjs-agentic/memory@0.5.0
