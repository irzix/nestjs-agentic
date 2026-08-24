---
"@nestjs-agentic/core": minor
"@nestjs-agentic/rag": minor
---

Add optional provenance/trust labels (`Provenance` / `ProvenanceSource`, `'model' | 'tool' | 'external' | 'user'`) to distinguish where content originated. `ToolExecutionResult`, the `{ role: 'tool' }` `ModelMessage`, and `DocumentChunk` now carry an optional `provenance` field. `LocalToolProvider` stamps tool results as `{ source: 'tool' }` and `KnowledgeBase` retrieval stamps chunks as `{ source: 'external' }`. `ToolPolicy.evaluateOutput` receives the label as an optional fourth argument for trust-aware decisions. Fully additive — no behavior change for code that ignores it. Closes #137.
