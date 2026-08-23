---
"@nestjs-agentic/rag": minor
---

Add real Reciprocal Rank Fusion (RRF) support to `HybridVectorStore` via a new `fusionMethod: 'weighted' | 'rrf'` option (default `'weighted'`, preserving existing behavior), plus a standalone `reciprocalRankFusion` utility for fusing any ranked id lists (e.g. RAG-Fusion-style multi-query variants). Closes #130.
