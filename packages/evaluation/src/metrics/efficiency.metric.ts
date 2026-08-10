import type { AgentResult } from '@nestjs-agentic/core';
import type { EvalDatasetItem, EvalMetric, MetricResult } from '../interfaces/evaluation.interface';

export interface EfficiencyMetricOptions {
  stepWeight?: number;
  latencyWeight?: number;
  tokenWeight?: number;
  minScoreThreshold?: number;
}

export class ExecutionEfficiencyMetric implements EvalMetric {
  readonly name = 'ExecutionEfficiency';
  private readonly stepWeight: number;
  private readonly latencyWeight: number;
  private readonly tokenWeight: number;
  private readonly minScoreThreshold: number;

  constructor(options?: EfficiencyMetricOptions) {
    this.stepWeight = options?.stepWeight ?? 0.5;
    this.latencyWeight = options?.latencyWeight ?? 0.3;
    this.tokenWeight = options?.tokenWeight ?? 0.2;
    this.minScoreThreshold = options?.minScoreThreshold ?? 0.6;
  }

  evaluate(item: EvalDatasetItem, result: AgentResult): MetricResult {
    const maxSteps = item.maxAllowedSteps ?? 5;
    const maxLatencyMs = item.maxAllowedLatencyMs ?? 10000;
    const maxTokens = item.maxAllowedTokens ?? 4000;

    const actualSteps = result.toolCalls?.length || 0;
    // Estimate tokens if not present in metadata
    const actualTokens = (result as any).tokensUsed || (result.output.length / 4 + actualSteps * 50);
    const actualLatencyMs = (result as any).durationMs || 100;

    // Mathematical Efficiency Ratios (0.0 to 1.0)
    const stepRatio = Math.min(1.0, maxSteps / Math.max(actualSteps, 1));
    const latencyRatio = Math.min(1.0, maxLatencyMs / Math.max(actualLatencyMs, 1));
    const tokenRatio = Math.min(1.0, maxTokens / Math.max(actualTokens, 1));

    // Weighted Overall Score
    const compositeScore =
      this.stepWeight * stepRatio + this.latencyWeight * latencyRatio + this.tokenWeight * tokenRatio;

    const passed = compositeScore >= this.minScoreThreshold;

    return {
      metricName: this.name,
      passed,
      score: Number(compositeScore.toFixed(4)),
      reason: passed
        ? `Weighted Efficiency Score (${compositeScore.toFixed(4)}) >= threshold (${this.minScoreThreshold})`
        : `Weighted Efficiency Score (${compositeScore.toFixed(4)}) below threshold (${this.minScoreThreshold})`,
      details: {
        stepRatio,
        latencyRatio,
        tokenRatio,
        actualSteps,
        actualLatencyMs,
        actualTokens,
      },
    };
  }
}

// Export backward compatible alias
export const EfficiencyMetric = ExecutionEfficiencyMetric;
