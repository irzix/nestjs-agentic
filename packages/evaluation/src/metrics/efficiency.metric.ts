import type { AgentResult } from '@nestjs-agentic/core';
import type { EvalDatasetItem, EvalMetric, MetricResult } from '../interfaces/evaluation.interface';

/**
 * Configuration options for ExecutionEfficiencyMetric.
 */
export interface EfficiencyMetricOptions {
  /** Relative weight given to tool step count ratio (0.0 to 1.0). Default: `0.5` */
  stepWeight?: number;

  /** Relative weight given to execution latency ratio (0.0 to 1.0). Default: `0.3` */
  latencyWeight?: number;

  /** Relative weight given to token consumption ratio (0.0 to 1.0). Default: `0.2` */
  tokenWeight?: number;

  /** Minimum composite score threshold required to pass. Default: `0.6` */
  minScoreThreshold?: number;
}

/**
 * Metric evaluator calculating weighted multi-variable execution efficiency (steps, latency, token consumption).
 */
export class ExecutionEfficiencyMetric implements EvalMetric {
  readonly name = 'ExecutionEfficiency';
  private readonly stepWeight: number;
  private readonly latencyWeight: number;
  private readonly tokenWeight: number;
  private readonly minScoreThreshold: number;

  /**
   * Creates a new instance of ExecutionEfficiencyMetric.
   * @param options Configuration options.
   */
  constructor(options?: EfficiencyMetricOptions) {
    this.stepWeight = options?.stepWeight ?? 0.5;
    this.latencyWeight = options?.latencyWeight ?? 0.3;
    this.tokenWeight = options?.tokenWeight ?? 0.2;
    this.minScoreThreshold = options?.minScoreThreshold ?? 0.6;
  }

  /**
   * Evaluates the execution efficiency ratio across steps, latency, and tokens.
   */
  evaluate(item: EvalDatasetItem, result: AgentResult): MetricResult {
    const maxSteps = item.maxAllowedSteps ?? 5;
    const maxLatencyMs = item.maxAllowedLatencyMs ?? 10000;
    const maxTokens = item.maxAllowedTokens ?? 4000;

    const actualSteps = result.toolCalls?.length || 0;
    const rawResult = result as unknown as Record<string, unknown>;
    const actualTokens =
      (typeof rawResult.tokensUsed === 'number' ? rawResult.tokensUsed : undefined) ??
      result.usage?.totalTokens ??
      result.output.length / 4 + actualSteps * 50;
    const actualLatencyMs =
      (typeof rawResult.durationMs === 'number' ? rawResult.durationMs : undefined) ?? 100;

    const stepRatio = Math.min(1.0, maxSteps / Math.max(actualSteps, 1));
    const latencyRatio = Math.min(1.0, maxLatencyMs / Math.max(actualLatencyMs, 1));
    const tokenRatio = Math.min(1.0, maxTokens / Math.max(actualTokens, 1));

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

/** Export backward-compatible alias */
export const EfficiencyMetric = ExecutionEfficiencyMetric;
