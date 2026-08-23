---
"@nestjs-agentic/rag": minor
---

Add `createCohereRerankProvider` and `createVoyageRerankProvider` built-in `RerankFunction` factories for `RerankerStrategy`. Add `RerankerStrategyOptions.minScore` to drop low-relevance chunks post-rerank, and `onRerankFailure`/`onRerankFailureMode` ('fallback' | 'throw') to make `rerankFn` failures observable instead of silently degrading to term-overlap scoring. Closes #132.
