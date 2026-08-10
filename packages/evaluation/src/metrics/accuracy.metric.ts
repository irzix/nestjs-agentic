import type { AgentResult } from '@nestjs-agentic/core';
import type { EvalDatasetItem, EvalMetric, MetricResult } from '../interfaces/evaluation.interface';

/**
 * Interface defining a generic embedding provider for vector cosine similarity evaluation.
 */
export interface EmbeddingProviderLike {
  /** Generates embedding vectors for an array of input text strings. */
  embedChunks(texts: string[]): Promise<number[][]>;
}

/**
 * Configuration options for AccuracyGroundTruthMetric.
 */
export interface AccuracyMetricOptions {
  /** Minimum pass score threshold (0.0 to 1.0). Default: `0.65` */
  minScoreThreshold?: number;

  /** Optional embedding provider for vector cosine similarity mathematical evaluation. */
  embeddingProvider?: EmbeddingProviderLike;
}

/**
 * Metric evaluator calculating mathematical accuracy using Vector Cosine Similarity or Sørensen-Dice Token Similarity.
 */
export class AccuracyGroundTruthMetric implements EvalMetric {
  readonly name = 'AccuracyGroundTruth';
  private readonly minScoreThreshold: number;
  private readonly embeddingProvider?: EmbeddingProviderLike;

  /**
   * Creates a new instance of AccuracyGroundTruthMetric.
   * @param options Metric options or minimum score threshold number.
   */
  constructor(options?: AccuracyMetricOptions | number) {
    if (typeof options === 'number') {
      this.minScoreThreshold = options;
    } else {
      this.minScoreThreshold = options?.minScoreThreshold ?? 0.65;
      this.embeddingProvider = options?.embeddingProvider;
    }
  }

  /**
   * Evaluates the output accuracy of the agent response against the expected ground truth.
   */
  async evaluate(item: EvalDatasetItem, result: AgentResult): Promise<MetricResult> {
    if (!item.expectedOutput) {
      return {
        metricName: this.name,
        passed: true,
        score: 1.0,
        reason: 'No expected output specified for item',
      };
    }

    const actual = result.output.trim();
    const expected = item.expectedOutput.trim();

    if (!actual) {
      return {
        metricName: this.name,
        passed: false,
        score: 0.0,
        reason: 'Agent returned empty output string',
      };
    }

    if (this.embeddingProvider) {
      try {
        const [vecActual, vecExpected] = await this.embeddingProvider.embedChunks([actual, expected]);
        const cosineSim = this.calculateCosineSimilarity(vecActual, vecExpected);
        const passed = cosineSim >= this.minScoreThreshold;

        return {
          metricName: this.name,
          passed,
          score: Number(cosineSim.toFixed(4)),
          reason: passed
            ? `Vector Cosine Similarity (${cosineSim.toFixed(4)}) >= threshold (${this.minScoreThreshold})`
            : `Vector Cosine Similarity (${cosineSim.toFixed(4)}) below threshold (${this.minScoreThreshold})`,
          details: { cosineSimilarity: cosineSim, method: 'vector_cosine' },
        };
      } catch {
        // Fallback to Dice coefficient if vector embedding fails
      }
    }

    const actualTokens = actual.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const expectedTokens = expected.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

    if (expectedTokens.length === 0) {
      return { metricName: this.name, passed: true, score: 1.0 };
    }

    const setExpected = new Set(expectedTokens);
    let intersection = 0;

    for (const t of actualTokens) {
      if (setExpected.has(t)) {
        intersection++;
        setExpected.delete(t);
      }
    }

    const diceScore = (2 * intersection) / (actualTokens.length + expectedTokens.length);
    const passed = diceScore >= this.minScoreThreshold;

    return {
      metricName: this.name,
      passed,
      score: Number(diceScore.toFixed(4)),
      reason: passed
        ? `Sørensen-Dice Token Similarity (${diceScore.toFixed(4)}) >= threshold (${this.minScoreThreshold})`
        : `Sørensen-Dice Token Similarity (${diceScore.toFixed(4)}) below threshold (${this.minScoreThreshold})`,
      details: {
        diceScore,
        tokenIntersection: intersection,
        totalTokens: actualTokens.length + expectedTokens.length,
        method: 'sorensen_dice',
      },
    };
  }

  private calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;
    return Math.max(0, Math.min(1.0, dotProduct / magnitude));
  }
}
