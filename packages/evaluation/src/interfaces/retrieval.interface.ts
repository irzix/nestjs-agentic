import type { MetricResult } from './evaluation.interface';

/**
 * A retrieved chunk, as far as retrieval evaluation needs it. `DocumentChunk`
 * from `@nestjs-agentic/rag` satisfies it.
 */
export interface RetrievedChunk {
  id: string;
  /** Parent document id, used when relevance is labeled per document (`matchOn: 'parentId'`). */
  parentId?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * The output of one retrieval, as far as evaluation needs it. `RAGContext`
 * from `@nestjs-agentic/rag` satisfies it, so this package does not depend on
 * the RAG package.
 */
export interface RetrievalContext {
  query: string;
  chunks?: RetrievedChunk[];
  /**
   * Relevance score per chunk id. When present, chunks are ranked by it
   * (highest first), since post-retrieval strategies may reorder `chunks` for
   * prompt layout rather than relevance. Otherwise `chunks` order is the rank.
   */
  scores?: Map<string, number>;
}

/** A labeled query for retrieval evaluation. */
export interface RetrievalEvalDatasetItem {
  id: string;
  query: string;
  /**
   * Ground truth: the ids that answer the query. Chunk ids by default, or
   * document ids when the metric or runner uses `matchOn: 'parentId'`.
   */
  relevantIds: string[];
  /**
   * Graded relevance for nDCG, by id (for example 0 to 3). Relevant ids not
   * listed here count as 1.
   */
  relevanceGrades?: Record<string, number>;
  /** Reference answer, available to answer-level judges. */
  expectedAnswer?: string;
  /** Metadata filter forwarded to the retriever, e.g. for tenant isolation. */
  filter?: Record<string, unknown>;
}

/** Whether ground truth names chunks or the documents they came from. */
export type RelevanceMatch = 'id' | 'parentId';

/**
 * A metric scored against retrieval output rather than an agent trajectory.
 * Parallel to `EvalMetric`, which only sees `AgentResult`.
 */
export interface RetrievalEvalMetric {
  name: string;
  /**
   * @param item The labeled query.
   * @param context What the retriever returned for it.
   * @param answer An answer generated from that context, when the benchmark
   *   produces one. Needed only by answer-level metrics such as faithfulness.
   */
  evaluate(
    item: RetrievalEvalDatasetItem,
    context: RetrievalContext,
    answer?: string,
  ): Promise<MetricResult> | MetricResult;
}

/** Retrieval output and scores for one labeled query. */
export interface RetrievalEvalItemResult {
  item: RetrievalEvalDatasetItem;
  /** Ranked ids as matched against ground truth, highest relevance first. */
  retrievedIds: string[];
  /** The generated answer, when an `answer` function was configured. */
  answer?: string;
  metrics: MetricResult[];
  overallPassed: boolean;
  /** Mean of the item's metric scores. */
  score: number;
  /** Set when retrieval or answering threw; every metric then scores 0. */
  error?: string;
}

/** Aggregate result of a retrieval benchmark. */
export interface RetrievalBenchmarkSummary {
  totalItems: number;
  passedItems: number;
  failedItems: number;
  passRate: number;
  /**
   * Mean score per metric across items (macro average). The mean of `MRR` is
   * the dataset's Mean Reciprocal Rank.
   */
  metricAverages: Record<string, number>;
  /** Mean of the per-item scores. */
  averageScore: number;
  itemResults: RetrievalEvalItemResult[];
}
