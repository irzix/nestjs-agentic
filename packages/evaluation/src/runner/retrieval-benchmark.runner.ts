import type { MetricResult } from '../interfaces/evaluation.interface';
import type {
  RankBy,
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
   * Metrics scored per query. Default: `Recall@k`, `Precision@k`, `MRR@k`, and
   * `nDCG@k`, with the runner's `k`, `matchOn`, and `rankBy`. Names must be
   * unique; pass `name` to a metric to report it twice with different settings.
   */
  metrics?: RetrievalEvalMetric[];
  /** Results requested from the retriever per query. Default: `5` */
  topK?: number;
  /**
   * Cutoff for the default metrics. Default: `topK`. Set it lower than `topK`
   * when matching documents (`matchOn: 'parentId'`): several chunks of one
   * document share a rank, so retrieving more chunks than `k` keeps `k`
   * distinct documents available.
   */
  k?: number;
  /** What `relevantIds` name, for the default metrics and `retrievedIds`. Default: `'id'` */
  matchOn?: RelevanceMatch;
  /** How retrieved chunks are ranked, for the default metrics and `retrievedIds`. Default: `'scores'` */
  rankBy?: RankBy;
  /**
   * Generates an answer from the retrieved context, for answer-level metrics
   * such as `FaithfulnessMetric`. Typically an LLM call or an agent run. If it
   * throws, rank-based metrics still score the retrieval and the error is
   * reported as `answerError`.
   */
  answer?(item: RetrievalEvalDatasetItem, context: RetrievalContext): Promise<string> | string;
}

function toRetriever(source: RetrievalSource): Retriever {
  if (typeof source === 'function') return source;
  if (typeof source === 'object' && source !== null) {
    if (typeof (source as PipelineRetrievalSource).executePipeline === 'function') {
      const pipeline = source as PipelineRetrievalSource;
      return (query, topK, filter) => pipeline.executePipeline(query, topK, filter);
    }
    if (typeof (source as ScoredRetrievalSource).queryChunksScored === 'function') {
      const knowledgeBase = source as ScoredRetrievalSource;
      return async (query, topK, filter) => {
        const scored = await knowledgeBase.queryChunksScored(query, topK, filter);
        return {
          query,
          chunks: scored.map(({ chunk }) => chunk),
          scores: new Map(scored.map(({ chunk, score }) => [chunk.id, score])),
        };
      };
    }
  }
  throw new TypeError(
    'RetrievalBenchmarkRunner needs a Retriever function, an object with executePipeline() (RAGPipeline), or one with queryChunksScored() (KnowledgeBase).',
  );
}

function assertPositiveInteger(name: string, value: number): void {
  if (!(Number.isInteger(value) && value >= 1)) {
    throw new RangeError(`${name} must be a positive integer, received ${value}.`);
  }
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
  private readonly rankBy: RankBy;
  private readonly answer?: RetrievalBenchmarkRunnerOptions['answer'];

  constructor(source: RetrievalSource, options: RetrievalBenchmarkRunnerOptions = {}) {
    this.topK = options.topK ?? 5;
    assertPositiveInteger('topK', this.topK);
    const k = options.k ?? this.topK;
    assertPositiveInteger('k', k);
    this.matchOn = options.matchOn ?? 'id';
    this.rankBy = options.rankBy ?? 'scores';
    this.retrieve = toRetriever(source);
    this.answer = options.answer;
    const shared = { k, matchOn: this.matchOn, rankBy: this.rankBy };
    this.metrics = options.metrics ?? [
      new RecallAtKMetric(shared),
      new PrecisionAtKMetric(shared),
      new ReciprocalRankMetric(shared),
      new NdcgAtKMetric(shared),
    ];

    const seen = new Set<string>();
    for (const metric of this.metrics) {
      if (seen.has(metric.name)) {
        throw new Error(
          `Two metrics are named "${metric.name}", so their averages would collide. Give one a distinct name.`,
        );
      }
      seen.add(metric.name);
    }
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
    try {
      context = await this.retrieve(item.query, this.topK, item.filter);
      if (typeof context !== 'object' || context === null) {
        throw new TypeError(`the retriever returned ${String(context)} instead of a retrieval context`);
      }
    } catch (err: unknown) {
      const error = describe(err);
      return {
        item,
        retrievedIds: [],
        metrics: this.metrics.map((metric) => failed(metric.name, `Retrieval failed: ${error}`)),
        overallPassed: false,
        score: 0,
        error,
      };
    }

    // A failing generation step does not take the retrieval scores with it.
    let answer: string | undefined;
    let answerError: string | undefined;
    if (this.answer) {
      try {
        answer = await this.answer(item, context);
      } catch (err: unknown) {
        answerError = describe(err);
      }
    }

    const metrics: MetricResult[] = [];
    for (const metric of this.metrics) {
      try {
        const result = await metric.evaluate(item, context, answer);
        metrics.push(
          Number.isFinite(result.score)
            ? result
            : failed(metric.name, `The metric returned a score that is not a finite number (${result.score}).`),
        );
      } catch (err: unknown) {
        metrics.push(failed(metric.name, `The metric threw: ${describe(err)}`));
      }
    }
    return {
      item,
      retrievedIds: rankedIds(context, this.matchOn, this.rankBy),
      ...(answer !== undefined ? { answer } : {}),
      ...(answerError !== undefined ? { answerError } : {}),
      metrics,
      overallPassed: metrics.every((m) => m.passed),
      score: round(mean(metrics.map((m) => m.score))),
    };
  }
}

function failed(metricName: string, reason: string): MetricResult {
  return { metricName, passed: false, score: 0, reason };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Mean of the finite values; a non-finite value counts as 0 so it can never pass a gate. */
function mean(values: number[]): number {
  const safe = values.map((v) => (Number.isFinite(v) ? v : 0));
  return safe.length ? safe.reduce((sum, v) => sum + v, 0) / safe.length : 0;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
