---
'@nestjs-agentic/rag': patch
---

Fix `HybridVectorStore.addChunks` issuing one `embedQuery` call per unembedded chunk instead of using the batch `embedDocuments` API `EmbeddingProvider` already defines. Ingesting a codebase with hundreds of AST-split chunks meant hundreds of concurrent HTTP requests instead of a handful of batched ones — worse latency, worse cost, and more likely to trip provider rate limits.

- `addChunks` now embeds unembedded chunks via `embedDocuments()`, chunked into groups of a new `embeddingBatchSize` option (default `100`) so a single call for an unbounded number of chunks doesn't exceed a provider's per-request size limit.
- Confirmed and documented that mutating the input `DocumentChunk` objects in place (to attach the generated `embedding`) is intentional: `KnowledgeBase.ingestDocument` passes the same array it keeps a reference to and relies on seeing the embedding on it afterward.
- Added regression tests proving a batch of 7 chunks issues exactly one `embedDocuments` call (not 7 `embedQuery` calls), and that a batch larger than `embeddingBatchSize` splits into the correct number of batched calls.

An embedding cache (in-memory LRU with a pluggable Redis backend) remains tracked separately as forward work in issue #134.
