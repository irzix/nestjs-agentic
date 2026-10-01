import type { MetricResult } from '../../interfaces/evaluation.interface';
import type {
  RankBy,
  RetrievalContext,
  RetrievalEvalDatasetItem,
  RetrievalEvalMetric,
} from '../../interfaces/retrieval.interface';
import { rankedChunks } from './ranking';

/** What a faithfulness judge sees. */
export interface FaithfulnessJudgeInput {
  query: string;
  /** The generated answer under review. */
  answer: string;
  /**
   * What the answer must be grounded in: the retrieved passages, highest
   * relevance first, followed by any context the pipeline hands to generation
   * besides them (hydrated parents, compressed context, graph facts).
   */
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
  /** Retrieved passages handed to the judge, from the top of the ranking. A positive integer. Default: all. */
  maxContexts?: number;
  /** How retrieved chunks are ranked. Default: `'scores'` */
  rankBy?: RankBy;
  /**
   * Builds the judge's contexts from the retrieval, replacing the default
   * (ranked passages plus generation context), for pipelines that generate
   * from something else.
   */
  contexts?(context: RetrievalContext): string[];
  /** Overrides the metric's name, e.g. to report two judges side by side. Default: `'Faithfulness'` */
  name?: string;
}

/**
 * Faithfulness (groundedness): whether a generated answer is supported by the
 * retrieved context rather than invented. Needs an answer, so run it with
 * `RetrievalBenchmarkRunner`'s `answer` option.
 */
export class FaithfulnessMetric implements RetrievalEvalMetric {
  readonly name: string;
  private readonly threshold: number;

  constructor(private readonly judge: FaithfulnessJudge, private readonly options: FaithfulnessMetricOptions = {}) {
    this.name = options.name ?? 'Faithfulness';
    this.threshold = options.threshold ?? 0.7;
    if (options.maxContexts !== undefined && !(Number.isInteger(options.maxContexts) && options.maxContexts >= 1)) {
      throw new RangeError(`maxContexts must be a positive integer, received ${options.maxContexts}.`);
    }
  }

  async evaluate(item: RetrievalEvalDatasetItem, context: RetrievalContext, answer?: string): Promise<MetricResult> {
    if (answer === undefined) {
      return {
        metricName: this.name,
        passed: false,
        score: 0,
        reason: 'No answer to judge: configure RetrievalBenchmarkRunner with an `answer` function, or see the item\'s answerError.',
      };
    }

    const contexts = this.options.contexts ? this.options.contexts(context) : this.defaultContexts(context);

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

  /** Ranked passages, then the generation context strategies add beside them. */
  private defaultContexts(context: RetrievalContext): string[] {
    const passages = rankedChunks(context, this.options.rankBy).map((chunk) => chunk.content);
    const extra = [
      context.hydratedParentContext,
      context.compressedContext,
      context.graphContext,
      ...(context.relationalFacts ?? []),
    ].filter((text): text is string => typeof text === 'string' && text.length > 0);
    return [...passages.slice(0, this.options.maxContexts), ...extra];
  }
}
