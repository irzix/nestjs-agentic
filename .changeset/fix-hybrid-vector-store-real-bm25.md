---
'@nestjs-agentic/rag': patch
---

Fix `HybridVectorStore`'s sparse score computing plain term frequency (`matchCount / tokens.length`) despite being named/documented as BM25. It had no IDF term and no `k1`/`b` saturation, so it couldn't down-weight common words or up-weight rare, distinctive terms — the entire point of BM25 for code/text hybrid search.

- `HybridVectorStore` now maintains incremental corpus-level statistics (per-term document frequency, total token count) on `addChunks` (including upsert), `deleteChunk`, and `clear`, and computes real BM25 (Robertson/Sparck-Jones formula) at query time.
- Added `bm25K1` (term-frequency saturation, default `1.2`) and `bm25B` (document-length normalization, default `0.75`) constructor options with standard defaults.
- Existing `vectorWeight` fusion behavior (max-normalized weighted sum with the dense cosine score) is unchanged — this only replaces the sparse score's own computation.
- Added a regression test proving a chunk containing a rare, distinctive term outranks a chunk that merely repeats a common term many times — the opposite of what the previous term-frequency-only formula would have ranked.

Updated `docs/ARCHITECTURE.md` and `apps/landing/content/docs/rag/hybrid-vector-store.mdx` to describe the real BM25 formula instead of the tracked-as-future-work placeholder text.
