---
"@nestjs-agentic/core": minor
"@nestjs-agentic/rag": minor
---

Add optional provenance/trust labels (`Provenance` / `ProvenanceSource`, `'model' | 'tool' | 'external' | 'user'`) to distinguish where content originated. `ToolExecutionResult` (all branches), the `{ role: 'tool' }` `ModelMessage`, and `DocumentChunk` now carry an optional `provenance` field. `LocalToolProvider` stamps successful tool results with `{ source: 'tool', origin: <toolName> }` and `AgentExecutor` stamps failed tool payloads and the resulting tool message the same way. `KnowledgeBase` retrieval always stamps chunks with `{ source: 'external', origin: <parentId> }` — retrieval is a trust boundary, so a store cannot launder external content under a trusted label. `ToolPolicy.evaluateOutput` receives the label as an optional fourth argument for trust-aware decisions. Fully additive — no behavior change for code that ignores it. Closes #137.
