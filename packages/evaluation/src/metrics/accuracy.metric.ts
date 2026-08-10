import type { AgentResult } from '@nestjs-agentic/core';
import type { EvalDatasetItem, EvalMetric, MetricResult } from '../interfaces/evaluation.interface';

export class AccuracyGroundTruthMetric implements EvalMetric {
  readonly name = 'AccuracyGroundTruth';

  constructor(private readonly minScoreThreshold = 0.6) {}

  evaluate(item: EvalDatasetItem, result: AgentResult): MetricResult {
    if (!item.expectedOutput) {
      return {
        metricName: this.name,
        passed: true,
        score: 1.0,
        reason: 'No expected output specified for item',
      };
    }

    const expectedTokens = new Set(
      item.expectedOutput.toLowerCase().split(/\s+/).filter((t) => t.length > 2),
    );

    if (expectedTokens.size === 0) {
      return { metricName: this.name, passed: true, score: 1.0 };
    }

    const outputTokens = result.output.toLowerCase().split(/\s+/);
    let matches = 0;
    for (const t of expectedTokens) {
      if (outputTokens.includes(t)) {
        matches++;
      }
    }

    const score = matches / expectedTokens.size;
    const passed = score >= this.minScoreThreshold;

    return {
      metricName: this.name,
      passed,
      score: Math.min(1.0, Number(score.toFixed(2))),
      reason: passed
        ? `Output matched ground truth key terms (${matches}/${expectedTokens.size})`
        : `Output missed ground truth key terms (${matches}/${expectedTokens.size})`,
    };
  }
}
