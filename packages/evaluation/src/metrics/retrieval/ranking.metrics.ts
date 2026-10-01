import type { MetricResult } from '../../interfaces/evaluation.interface';
import type {
  RelevanceMatch,
  RetrievalContext,
  RetrievalEvalDatasetItem,
  RetrievalEvalMetric,
} from '../../interfaces/retrieval.interface';
import { rankedIds } from './ranking';

/** Options shared by the rank-based retrieval metrics. */
export interface RankingMetricOptions {
  /** Score at or above which the metric passes for an item. Default: `0.5` */
  threshold?: number;
  /** Whether `relevantIds` name chunks or parent documents. Default: `'id'` */
  matchOn?: RelevanceMatch;
}

/** Options for metrics computed over the top `k` results. */
export interface CutoffMetricOptions extends RankingMetricOptions {
  /** Number of top-ranked results considered. */
  k: number;
}

function assertK(k: number): void {
  if (!(Number.isInteger(k) && k >= 1)) {
    throw new RangeError(`k must be a positive integer, received ${k}.`);
  }
}

/** Shared scaffolding: ranks the context, guards unlabeled items, and builds the result. */
abstract class RankingMetric implements RetrievalEvalMetric {
  abstract readonly name: string;
  protected readonly threshold: number;
  protected readonly matchOn: RelevanceMatch;

  constructor(options: RankingMetricOptions = {}) {
    this.threshold = options.threshold ?? 0.5;
    this.matchOn = options.matchOn ?? 'id';
  }

  evaluate(item: RetrievalEvalDatasetItem, context: RetrievalContext): MetricResult {
    const relevant = new Set(item.relevantIds);
    if (relevant.size === 0) {
      return {
        metricName: this.name,
        passed: false,
        score: 0,
        reason: 'The item has no relevantIds, so retrieval quality cannot be measured.',
      };
    }
    const ranked = rankedIds(context, this.matchOn);
    const { score, details, reason } = this.score(ranked, relevant, item);
    const rounded = Number(score.toFixed(4));
    return {
      metricName: this.name,
      passed: rounded >= this.threshold,
      score: rounded,
      reason,
      details: { ...details, retrieved: ranked.length, relevant: relevant.size },
    };
  }

  protected abstract score(
    ranked: string[],
    relevant: Set<string>,
    item: RetrievalEvalDatasetItem,
  ): { score: number; reason: string; details?: Record<string, unknown> };
}

/**
 * Recall@k: the share of relevant ids that appear in the top `k` results.
 * Answers "did retrieval find what the answer needs?".
 */
export class RecallAtKMetric extends RankingMetric {
  readonly name: string;
  private readonly k: number;

  constructor(options: CutoffMetricOptions) {
    super(options);
    assertK(options.k);
    this.k = options.k;
    this.name = `Recall@${options.k}`;
  }

  protected score(ranked: string[], relevant: Set<string>) {
    const found = ranked.slice(0, this.k).filter((id) => relevant.has(id));
    return {
      score: found.length / relevant.size,
      reason: `${found.length} of ${relevant.size} relevant ids in the top ${this.k}`,
      details: { k: this.k, found },
    };
  }
}

/**
 * Precision@k: the share of the top `k` slots holding a relevant id. The
 * denominator is always `k`, so returning fewer than `k` results is not
 * rewarded.
 */
export class PrecisionAtKMetric extends RankingMetric {
  readonly name: string;
  private readonly k: number;

  constructor(options: CutoffMetricOptions) {
    super(options);
    assertK(options.k);
    this.k = options.k;
    this.name = `Precision@${options.k}`;
  }

  protected score(ranked: string[], relevant: Set<string>) {
    const hits = ranked.slice(0, this.k).filter((id) => relevant.has(id)).length;
    return {
      score: hits / this.k,
      reason: `${hits} of the top ${this.k} slots are relevant`,
      details: { k: this.k, hits },
    };
  }
}

/** Hit rate@k: 1 when at least one relevant id is in the top `k`, else 0. */
export class HitRateAtKMetric extends RankingMetric {
  readonly name: string;
  private readonly k: number;

  constructor(options: CutoffMetricOptions) {
    super(options);
    assertK(options.k);
    this.k = options.k;
    this.name = `HitRate@${options.k}`;
  }

  protected score(ranked: string[], relevant: Set<string>) {
    const hit = ranked.slice(0, this.k).some((id) => relevant.has(id));
    return {
      score: hit ? 1 : 0,
      reason: hit ? `a relevant id is in the top ${this.k}` : `no relevant id in the top ${this.k}`,
      details: { k: this.k },
    };
  }
}

/**
 * Reciprocal rank: `1 / rank` of the first relevant result, or 0 when none is
 * retrieved (within the top `k`, when `k` is set). Averaged over a dataset by
 * `RetrievalBenchmarkRunner`, this is the Mean Reciprocal Rank (MRR).
 */
export class ReciprocalRankMetric extends RankingMetric {
  readonly name: string;
  private readonly k?: number;

  constructor(options: RankingMetricOptions & { k?: number } = {}) {
    super(options);
    if (options.k !== undefined) assertK(options.k);
    this.k = options.k;
    this.name = options.k === undefined ? 'MRR' : `MRR@${options.k}`;
  }

  protected score(ranked: string[], relevant: Set<string>) {
    const considered = this.k === undefined ? ranked : ranked.slice(0, this.k);
    const index = considered.findIndex((id) => relevant.has(id));
    return index === -1
      ? { score: 0, reason: 'no relevant id retrieved', details: { firstRelevantRank: null } }
      : {
          score: 1 / (index + 1),
          reason: `first relevant id at rank ${index + 1}`,
          details: { firstRelevantRank: index + 1 },
        };
  }
}

/**
 * nDCG@k: discounted cumulative gain of the top `k`, normalized by the best
 * possible ordering. Uses `relevanceGrades` when given (relevant ids without a
 * grade count as 1), so a ranking that puts the most useful result first
 * scores higher. Gain is `2^grade - 1`, discounted by `log2(rank + 1)`.
 */
export class NdcgAtKMetric extends RankingMetric {
  readonly name: string;
  private readonly k: number;

  constructor(options: CutoffMetricOptions) {
    super(options);
    assertK(options.k);
    this.k = options.k;
    this.name = `nDCG@${options.k}`;
  }

  protected score(ranked: string[], relevant: Set<string>, item: RetrievalEvalDatasetItem) {
    const grade = (id: string): number => {
      const explicit = item.relevanceGrades?.[id];
      if (typeof explicit === 'number' && Number.isFinite(explicit)) return Math.max(0, explicit);
      return relevant.has(id) ? 1 : 0;
    };
    const dcgOf = (grades: number[]): number =>
      grades.reduce((sum, g, i) => sum + (Math.pow(2, g) - 1) / Math.log2(i + 2), 0);

    const dcg = dcgOf(ranked.slice(0, this.k).map(grade));
    const labeled = new Set([...relevant, ...Object.keys(item.relevanceGrades ?? {})]);
    const ideal = dcgOf(
      [...labeled]
        .map(grade)
        .sort((a, b) => b - a)
        .slice(0, this.k),
    );
    const score = ideal > 0 ? dcg / ideal : 0;
    return {
      score,
      reason: `DCG ${dcg.toFixed(4)} of an ideal ${ideal.toFixed(4)} over the top ${this.k}`,
      details: { k: this.k, dcg: Number(dcg.toFixed(4)), idealDcg: Number(ideal.toFixed(4)) },
    };
  }
}
