---
"@nestjs-agentic/evaluation": minor
---

Add retrieval-quality metrics for RAG pipelines.

- New `RetrievalEvalMetric` contract, parallel to `EvalMetric`, scored against retrieval output (`RetrievalContext`, which `RAGContext` satisfies structurally) rather than an `AgentResult`. Dataset items carry ground truth as `relevantIds`, with optional `relevanceGrades`.
- Metrics: `RecallAtKMetric`, `PrecisionAtKMetric`, `HitRateAtKMetric`, `ReciprocalRankMetric` (MRR), `NdcgAtKMetric` (graded relevance), and `FaithfulnessMetric` with a pluggable judge that sees the passages plus any hydrated, compressed, or graph context the pipeline produced.
- Relevance is matched per chunk (`matchOn: 'id'`), per document (`'parentId'`), or by any function of the chunk. Results are ranked by `context.scores` when present, or by `chunks` order with `rankBy: 'order'` for rerankers such as MMR.
- `RetrievalBenchmarkRunner` runs a labeled query set through a `RAGPipeline`, a `KnowledgeBase`, or any retriever function, optionally generates answers for answer-level metrics, and reports per-metric averages for CI gates. Its defaults are `Recall@k`, `Precision@k`, `MRR@k`, and `nDCG@k`, with `k` separate from `topK`. A failing retrieval scores its item 0, a failing answer step is reported as `answerError` without discarding the retrieval scores, and a failing metric fails only itself.
