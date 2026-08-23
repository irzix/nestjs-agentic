# @nestjs-agentic/rag

## 1.0.1

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

  - @nestjs-agentic/memory@1.0.1

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
