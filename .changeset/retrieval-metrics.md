---
"@nestjs-agentic/evaluation": minor
---

Add retrieval-quality metrics for RAG pipelines.

- New `RetrievalEvalMetric` contract, parallel to `EvalMetric`, scored against retrieval output (`RetrievalContext`, which `RAGContext` satisfies structurally) rather than an `AgentResult`. Dataset items carry ground truth as `relevantIds`, with optional `relevanceGrades`.
- Metrics: `RecallAtKMetric`, `PrecisionAtKMetric`, `HitRateAtKMetric`, `ReciprocalRankMetric` (MRR), `NdcgAtKMetric` (graded relevance), and `FaithfulnessMetric` with a pluggable judge. Results are ranked by `context.scores` when present. `matchOn: 'parentId'` labels relevance per document instead of per chunk.
- `RetrievalBenchmarkRunner` runs a labeled query set through a `RAGPipeline`, a `KnowledgeBase`, or any retriever function, optionally generates answers for answer-level metrics, and reports per-metric averages for CI gates. A failing retrieval scores its item 0 instead of aborting the run.
