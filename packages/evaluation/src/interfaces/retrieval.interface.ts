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
   * Relevance score per chunk id. By default chunks are ranked by it
   * (highest first) when present, since post-retrieval strategies such as
   * U-shaped context reorder `chunks` for prompt layout rather than
   * relevance. See `RankBy`.
   */
  scores?: Map<string, number>;
  /** Context that pipelines hand to generation besides the chunks, read by `FaithfulnessMetric`. */
  hydratedParentContext?: string;
  compressedContext?: string;
  graphContext?: string;
  relationalFacts?: string[];
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

/**
 * What ground truth names: chunk ids (`'id'`), the chunk's `parentId`
 * (`'parentId'`, the document id for most splitters), or any id derived from
 * the chunk. `ParentChildSplitter` children, for instance, have a section as
 * their parent, so match documents with
 * `(chunk) => chunk.parentId?.replace(/_parent_\d+$/, '') ?? chunk.id`.
 */
export type RelevanceMatch = 'id' | 'parentId' | ((chunk: RetrievedChunk) => string);

/**
 * How retrieved chunks are ranked.
 *
 * - `'scores'` (default): by `context.scores` when present, else by `chunks`
 *   order. Right for pipelines whose last reordering is for layout.
 * - `'order'`: by `chunks` order. Right for pipelines whose last step
 *   reranks chunks without rewriting their scores, such as MMR.
 */
export type RankBy = 'scores' | 'order';

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
  /** Set when retrieval threw; every metric then scores 0. */
  error?: string;
  /** Set when retrieval worked but the `answer` function threw; answer-level metrics then fail. */
  answerError?: string;
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
