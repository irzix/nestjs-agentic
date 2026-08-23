---
"@nestjs-agentic/rag": minor
---

Add `CachedEmbeddingProvider`, an `EmbeddingProvider` decorator that caches embeddings by a content hash (namespaced by `cacheNamespace`), using an in-memory LRU cache by default or a pluggable `StateStore` (e.g. Redis) backend. Closes #134.
