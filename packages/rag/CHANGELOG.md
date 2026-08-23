# @nestjs-agentic/rag

## 1.0.1

### Patch Changes

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
