import type { MetricResult } from '../interfaces/evaluation.interface';
import type {
  RelevanceMatch,
  RetrievalBenchmarkSummary,
  RetrievalContext,
  RetrievalEvalDatasetItem,
  RetrievalEvalItemResult,
  RetrievalEvalMetric,
  RetrievedChunk,
} from '../interfaces/retrieval.interface';
import {
  NdcgAtKMetric,
  PrecisionAtKMetric,
  RecallAtKMetric,
  ReciprocalRankMetric,
} from '../metrics/retrieval/ranking.metrics';
import { rankedIds } from '../metrics/retrieval/ranking';

/** Retrieves for one query. */
export type Retriever = (
  query: string,
  topK: number,
  filter?: Record<string, unknown>,
) => Promise<RetrievalContext> | RetrievalContext;

/** Anything shaped like `RAGPipeline`: strategies run before and after retrieval are evaluated too. */
export interface PipelineRetrievalSource {
  executePipeline(query: string, topK?: number, filter?: Record<string, unknown>): Promise<RetrievalContext>;
}

/** Anything shaped like `KnowledgeBase`: evaluates the raw vector or hybrid search. */
export interface ScoredRetrievalSource {
  queryChunksScored(
    query: string,
    limit?: number,
    filter?: Record<string, unknown>,
  ): Promise<Array<{ chunk: RetrievedChunk; score: number }>>;
}

/** What `RetrievalBenchmarkRunner` can evaluate. */
export type RetrievalSource = Retriever | PipelineRetrievalSource | ScoredRetrievalSource;

export interface RetrievalBenchmarkRunnerOptions {
  /**
   * Metrics scored per query. Default: `Recall@k`, `Precision@k`, `MRR`, and
   * `nDCG@k`, with `k = topK` and the runner's `matchOn`.
   */
  metrics?: RetrievalEvalMetric[];
  /** Results requested from the retriever per query. Default: `5` */
  topK?: number;
  /** Whether `relevantIds` name chunks or parent documents, for the default metrics and `retrievedIds`. Default: `'id'` */
  matchOn?: RelevanceMatch;
  /**
   * Generates an answer from the retrieved context, for answer-level metrics
   * such as `FaithfulnessMetric`. Typically an LLM call or an agent run.
   */
  answer?(item: RetrievalEvalDatasetItem, context: RetrievalContext): Promise<string> | string;
}

function toRetriever(source: RetrievalSource): Retriever {
  if (typeof source === 'function') return source;
  if ('executePipeline' in source) {
    return (query, topK, filter) => source.executePipeline(query, topK, filter);
  }
  return async (query, topK, filter) => {
    const scored = await source.queryChunksScored(query, topK, filter);
    return {
      query,
      chunks: scored.map(({ chunk }) => chunk),
      scores: new Map(scored.map(({ chunk, score }) => [chunk.id, score])),
    };
  };
}

/**
 * Runs a labeled query set through a retriever and scores each result, the
 * retrieval counterpart of `BenchmarkRunner`. Accepts a `RAGPipeline`, a
 * `KnowledgeBase`, or any `Retriever` function, so it can gate retrieval
 * changes in CI the same way agent regressions are gated.
 *
 * @example
 * const summary = await new RetrievalBenchmarkRunner(pipeline, { topK: 5 }).run(dataset);
 * if (summary.metricAverages['Recall@5'] < 0.8) process.exit(1);
 */
export class RetrievalBenchmarkRunner {
  private readonly retrieve: Retriever;
  private readonly metrics: RetrievalEvalMetric[];
  private readonly topK: number;
  private readonly matchOn: RelevanceMatch;
  private readonly answer?: RetrievalBenchmarkRunnerOptions['answer'];

  constructor(source: RetrievalSource, options: RetrievalBenchmarkRunnerOptions = {}) {
    this.topK = options.topK ?? 5;
    if (!(Number.isInteger(this.topK) && this.topK >= 1)) {
      throw new RangeError(`topK must be a positive integer, received ${options.topK}.`);
    }
    this.matchOn = options.matchOn ?? 'id';
    this.retrieve = toRetriever(source);
    this.answer = options.answer;
    this.metrics = options.metrics ?? [
      new RecallAtKMetric({ k: this.topK, matchOn: this.matchOn }),
      new PrecisionAtKMetric({ k: this.topK, matchOn: this.matchOn }),
      new ReciprocalRankMetric({ matchOn: this.matchOn }),
      new NdcgAtKMetric({ k: this.topK, matchOn: this.matchOn }),
    ];
  }

  /** Evaluates every item in order and aggregates the scores. */
  async run(dataset: RetrievalEvalDatasetItem[]): Promise<RetrievalBenchmarkSummary> {
    const itemResults: RetrievalEvalItemResult[] = [];
    for (const item of dataset) {
      itemResults.push(await this.evaluateItem(item));
    }

    const metricAverages: Record<string, number> = {};
    for (const metric of this.metrics) {
      const scores = itemResults.map((r) => r.metrics.find((m) => m.metricName === metric.name)?.score ?? 0);
      metricAverages[metric.name] = round(mean(scores));
    }

    const passedItems = itemResults.filter((r) => r.overallPassed).length;
    return {
      totalItems: itemResults.length,
      passedItems,
      failedItems: itemResults.length - passedItems,
      passRate: round(itemResults.length ? passedItems / itemResults.length : 0),
      metricAverages,
      averageScore: round(mean(itemResults.map((r) => r.score))),
      itemResults,
    };
  }

  private async evaluateItem(item: RetrievalEvalDatasetItem): Promise<RetrievalEvalItemResult> {
    let context: RetrievalContext;
    let answer: string | undefined;
    try {
      context = await this.retrieve(item.query, this.topK, item.filter);
      answer = this.answer ? await this.answer(item, context) : undefined;
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        item,
        retrievedIds: [],
        metrics: this.metrics.map((metric) => ({
          metricName: metric.name,
          passed: false,
          score: 0,
          reason: `Retrieval failed: ${error}`,
        })),
        overallPassed: false,
        score: 0,
        error,
      };
    }

    const metrics: MetricResult[] = [];
    for (const metric of this.metrics) {
      metrics.push(await metric.evaluate(item, context, answer));
    }
    return {
      item,
      retrievedIds: rankedIds(context, this.matchOn),
      ...(answer !== undefined ? { answer } : {}),
      metrics,
      overallPassed: metrics.every((m) => m.passed),
      score: round(mean(metrics.map((m) => m.score))),
    };
  }
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
