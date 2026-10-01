import type { MetricResult } from '../../interfaces/evaluation.interface';
import type {
  RankBy,
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
  /** What `relevantIds` name: chunks, parent documents, or a derived id. Default: `'id'` */
  matchOn?: RelevanceMatch;
  /** How retrieved chunks are ranked. Default: `'scores'` */
  rankBy?: RankBy;
  /** Overrides the metric's name, e.g. to report the same metric twice with different settings. */
  name?: string;
}

/** Options for metrics computed over the top `k` results. */
export interface CutoffMetricOptions extends RankingMetricOptions {
  /** Number of top-ranked results considered. */
  k: number;
}

/** Highest relevance grade used by nDCG; larger grades would overflow `2^grade`. */
const MAX_GRADE = 30;

function assertK(k: number): void {
  if (!(Number.isInteger(k) && k >= 1)) {
    throw new RangeError(`k must be a positive integer, received ${k}.`);
  }
}

interface Scored {
  score: number;
  reason: string;
  details?: Record<string, unknown>;
  /** What `passed` is decided on, when it differs from `score`. */
  passScore?: number;
}

/** Shared scaffolding: ranks the context, guards unlabeled items, and builds the result. */
abstract class RankingMetric implements RetrievalEvalMetric {
  readonly name: string;
  protected readonly threshold: number;
  protected readonly matchOn: RelevanceMatch;
  protected readonly rankBy: RankBy;

  constructor(defaultName: string, options: RankingMetricOptions = {}) {
    this.name = options.name ?? defaultName;
    this.threshold = options.threshold ?? 0.5;
    this.matchOn = options.matchOn ?? 'id';
    this.rankBy = options.rankBy ?? 'scores';
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
    const ranked = rankedIds(context, this.matchOn, this.rankBy);
    const { score, details, reason, passScore } = this.score(ranked, relevant, item);
    if (!Number.isFinite(score)) {
      return { metricName: this.name, passed: false, score: 0, reason: `The score is not a finite number (${score}).` };
    }
    const rounded = Number(score.toFixed(4));
    return {
      metricName: this.name,
      passed: Number((passScore ?? score).toFixed(4)) >= this.threshold,
      score: rounded,
      reason,
      details: { ...details, retrieved: ranked.length, relevant: relevant.size },
    };
  }

  protected abstract score(ranked: string[], relevant: Set<string>, item: RetrievalEvalDatasetItem): Scored;
}

/**
 * Recall@k: the share of relevant ids that appear in the top `k` results.
 * Answers "did retrieval find what the answer needs?".
 */
export class RecallAtKMetric extends RankingMetric {
  private readonly k: number;

  constructor(options: CutoffMetricOptions) {
    super(`Recall@${options.k}`, options);
    assertK(options.k);
    this.k = options.k;
  }

  protected score(ranked: string[], relevant: Set<string>): Scored {
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
 * score divides by `k`, so returning fewer than `k` results is not rewarded.
 *
 * With fewer relevant ids than `k`, a perfect ranking scores below 1, so
 * `passed` compares the score to the best achievable one,
 * `min(relevant, k) / k`: a threshold of 0.5 means "at least half as precise
 * as possible".
 */
export class PrecisionAtKMetric extends RankingMetric {
  private readonly k: number;

  constructor(options: CutoffMetricOptions) {
    super(`Precision@${options.k}`, options);
    assertK(options.k);
    this.k = options.k;
  }

  protected score(ranked: string[], relevant: Set<string>): Scored {
    const hits = ranked.slice(0, this.k).filter((id) => relevant.has(id)).length;
    const best = Math.min(relevant.size, this.k) / this.k;
    return {
      score: hits / this.k,
      passScore: (hits / this.k) / best,
      reason: `${hits} of the top ${this.k} slots are relevant (at most ${Math.min(relevant.size, this.k)} can be)`,
      details: { k: this.k, hits, maxAchievable: Number(best.toFixed(4)) },
    };
  }
}

/** Hit rate@k: 1 when at least one relevant id is in the top `k`, else 0. */
export class HitRateAtKMetric extends RankingMetric {
  private readonly k: number;

  constructor(options: CutoffMetricOptions) {
    super(`HitRate@${options.k}`, options);
    assertK(options.k);
    this.k = options.k;
  }

  protected score(ranked: string[], relevant: Set<string>): Scored {
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
  private readonly k?: number;

  constructor(options: RankingMetricOptions & { k?: number } = {}) {
    super(options.k === undefined ? 'MRR' : `MRR@${options.k}`, options);
    if (options.k !== undefined) assertK(options.k);
    this.k = options.k;
  }

  protected score(ranked: string[], relevant: Set<string>): Scored {
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
 * possible ordering. The relevant ids are `relevantIds`; `relevanceGrades`
 * grades them (ungraded ones count as 1, grades are capped at 30, and grades
 * for ids outside `relevantIds` are ignored), so a ranking that puts the most
 * useful result first scores higher. Gain is `2^grade - 1`, discounted by
 * `log2(rank + 1)`.
 */
export class NdcgAtKMetric extends RankingMetric {
  private readonly k: number;

  constructor(options: CutoffMetricOptions) {
    super(`nDCG@${options.k}`, options);
    assertK(options.k);
    this.k = options.k;
  }

  protected score(ranked: string[], relevant: Set<string>, item: RetrievalEvalDatasetItem): Scored {
    const grade = (id: string): number => {
      if (!relevant.has(id)) return 0;
      const explicit = item.relevanceGrades?.[id];
      return typeof explicit === 'number' && Number.isFinite(explicit)
        ? Math.min(MAX_GRADE, Math.max(0, explicit))
        : 1;
    };
    const dcgOf = (grades: number[]): number =>
      grades.reduce((sum, g, i) => sum + (Math.pow(2, g) - 1) / Math.log2(i + 2), 0);

    const dcg = dcgOf(ranked.slice(0, this.k).map(grade));
    const ideal = dcgOf(
      [...relevant]
        .map(grade)
        .sort((a, b) => b - a)
        .slice(0, this.k),
    );
    return {
      score: ideal > 0 ? dcg / ideal : 0,
      reason: `DCG ${dcg.toFixed(4)} of an ideal ${ideal.toFixed(4)} over the top ${this.k}`,
      details: { k: this.k, dcg: Number(dcg.toFixed(4)), idealDcg: Number(ideal.toFixed(4)) },
    };
  }
}
