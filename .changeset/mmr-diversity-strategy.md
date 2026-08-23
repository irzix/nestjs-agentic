---
"@nestjs-agentic/rag": minor
---

Add `MmrStrategy`, a post-retrieval Maximal Marginal Relevance diversity strategy that reduces near-duplicate chunks in retrieved context. Extract `cosineSimilarity` as a shared utility, used by both `MmrStrategy` and `HybridVectorStore`. Closes #133.
