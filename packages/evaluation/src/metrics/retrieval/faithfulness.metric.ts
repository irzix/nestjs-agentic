import type { MetricResult } from '../../interfaces/evaluation.interface';
import type {
  RetrievalContext,
  RetrievalEvalDatasetItem,
  RetrievalEvalMetric,
} from '../../interfaces/retrieval.interface';
import { rankedIds } from './ranking';

/** What a faithfulness judge sees. */
export interface FaithfulnessJudgeInput {
  query: string;
  /** The generated answer under review. */
  answer: string;
  /** Retrieved passages, highest relevance first, that the answer must be grounded in. */
  contexts: string[];
  expectedAnswer?: string;
}

/**
 * Decides how well an answer is supported by its retrieved context, from 0
 * (unsupported or contradicted) to 1 (every claim is grounded). Typically an
 * LLM call; any judge works.
 */
export type FaithfulnessJudge = (
  input: FaithfulnessJudgeInput,
) => Promise<{ score: number; reason: string }> | { score: number; reason: string };

export interface FaithfulnessMetricOptions {
  /** Score at or above which the answer passes. Default: `0.7` */
  threshold?: number;
  /** Passages handed to the judge, from the top of the ranking. Default: all retrieved. */
  maxContexts?: number;
}

/**
 * Faithfulness (groundedness): whether a generated answer is supported by the
 * retrieved context rather than invented. Needs an answer, so run it with
 * `RetrievalBenchmarkRunner`'s `answer` option.
 */
export class FaithfulnessMetric implements RetrievalEvalMetric {
  readonly name = 'Faithfulness';
  private readonly threshold: number;
  private readonly maxContexts?: number;

  constructor(private readonly judge: FaithfulnessJudge, options: FaithfulnessMetricOptions = {}) {
    this.threshold = options.threshold ?? 0.7;
    this.maxContexts = options.maxContexts;
  }

  async evaluate(item: RetrievalEvalDatasetItem, context: RetrievalContext, answer?: string): Promise<MetricResult> {
    if (answer === undefined) {
      return {
        metricName: this.name,
        passed: false,
        score: 0,
        reason: 'No answer was generated; configure RetrievalBenchmarkRunner with an `answer` function.',
      };
    }

    const byId = new Map((context.chunks ?? []).map((chunk) => [chunk.id, chunk.content]));
    const contexts = rankedIds(context)
      .map((id) => byId.get(id))
      .filter((content): content is string => content !== undefined)
      .slice(0, this.maxContexts);

    try {
      const { score, reason } = await this.judge({
        query: item.query,
        answer,
        contexts,
        expectedAnswer: item.expectedAnswer,
      });
      if (!Number.isFinite(score)) {
        throw new RangeError('the faithfulness judge must return a finite score');
      }
      const normalized = Number(Math.min(1, Math.max(0, score)).toFixed(4));
      return {
        metricName: this.name,
        passed: normalized >= this.threshold,
        score: normalized,
        reason,
        details: { contexts: contexts.length },
      };
    } catch (err: unknown) {
      return {
        metricName: this.name,
        passed: false,
        score: 0,
        reason: `Faithfulness judge failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
