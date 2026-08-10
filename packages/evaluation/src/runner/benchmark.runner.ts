import type { AgentRunner } from '@nestjs-agentic/core';
import type {
  BenchmarkSummary,
  EvalDatasetItem,
  EvalItemResult,
  EvalMetric,
  MetricResult,
  MultiTrialResult,
} from '../interfaces/evaluation.interface';
import { SafetyPolicyMetric } from '../metrics/safety-policy.metric';
import { AccuracyGroundTruthMetric } from '../metrics/accuracy.metric';
import { ExecutionEfficiencyMetric } from '../metrics/efficiency.metric';

/**
 * Options for configuring BenchmarkRunner execution.
 */
export interface BenchmarkRunnerOptions {
  /** Array of metric evaluators to run per dataset item. */
  metrics?: EvalMetric[];

  /** Number of evaluation trials per item to calculate statistical variance. Default: `1` */
  trialsPerItem?: number;
}

/**
 * Runner service for executing benchmark dataset suites across agent runners and calculating statistical metrics.
 */
export class BenchmarkRunner {
  private readonly metrics: EvalMetric[];
  private readonly trialsPerItem: number;

  /**
   * Creates a new instance of BenchmarkRunner.
   * @param runner Core AgentRunner instance to evaluate.
   * @param options Configuration options.
   */
  constructor(private readonly runner: AgentRunner, options?: BenchmarkRunnerOptions) {
    this.metrics = options?.metrics || [
      new SafetyPolicyMetric(),
      new AccuracyGroundTruthMetric(),
      new ExecutionEfficiencyMetric(),
    ];
    this.trialsPerItem = options?.trialsPerItem ?? 1;
  }

  /**
   * Runs a benchmark dataset suite across the target AgentRunner and evaluates all metric scores with statistical variance analysis.
   *
   * @param agentName Name of the target agent registered in AgentRunner.
   * @param dataset Array of benchmark dataset items to evaluate.
   * @returns Promise resolving to the comprehensive BenchmarkSummary report.
   */
  async runBenchmark(agentName: string, dataset: EvalDatasetItem[]): Promise<BenchmarkSummary> {
    const itemResults: EvalItemResult[] = [];

    for (const item of dataset) {
      const trialScores: number[] = [];
      let lastResult: EvalItemResult | null = null;

      for (let trial = 1; trial <= this.trialsPerItem; trial++) {
        const sessionId = `eval_${agentName}_${item.id}_t${trial}`;

        try {
          const agentResult = await this.runner.run(agentName, {
            sessionId,
            message: item.query,
            context: item.context,
          });

          const metricResults: MetricResult[] = [];
          for (const metric of this.metrics) {
            const res = await metric.evaluate(item, agentResult);
            metricResults.push(res);
          }

          const overallPassed = metricResults.every((m) => m.passed);
          const itemScore =
            metricResults.reduce((acc, m) => acc + m.score, 0) / Math.max(metricResults.length, 1);

          trialScores.push(itemScore);

          lastResult = {
            item,
            agentResult,
            metrics: metricResults,
            overallPassed,
            score: Number(itemScore.toFixed(4)),
          };
        } catch (err: any) {
          trialScores.push(0.0);
          lastResult = {
            item,
            agentResult: { sessionId, output: '', toolCalls: [] },
            metrics: [
              {
                metricName: 'ExecutionError',
                passed: false,
                score: 0.0,
                reason: err?.message || 'Agent execution exception',
              },
            ],
            overallPassed: false,
            score: 0.0,
          };
        }
      }

      const multiTrialSummary = this.calculateMultiTrialStats(trialScores);

      itemResults.push({
        ...lastResult!,
        score: multiTrialSummary.meanScore,
        overallPassed: multiTrialSummary.passRate >= 0.8,
        multiTrialSummary,
      });
    }

    const passedItems = itemResults.filter((r) => r.overallPassed).length;
    const failedItems = itemResults.length - passedItems;
    const passRate = itemResults.length ? passedItems / itemResults.length : 0;
    const averageScore = itemResults.length
      ? itemResults.reduce((sum, r) => sum + r.score, 0) / itemResults.length
      : 0;

    const overallVariance = this.calculateVariance(itemResults.map((r) => r.score));

    return {
      totalItems: itemResults.length,
      passedItems,
      failedItems,
      passRate: Number(passRate.toFixed(4)),
      averageScore: Number(averageScore.toFixed(4)),
      overallVariance: Number(overallVariance.toFixed(4)),
      itemResults,
    };
  }

  private calculateMultiTrialStats(scores: number[]): MultiTrialResult {
    if (scores.length === 0) {
      return { scores: [], meanScore: 0, standardDeviation: 0, passRate: 0 };
    }

    const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - meanScore, 2), 0) / scores.length;
    const standardDeviation = Math.sqrt(variance);
    const passRate = scores.filter((s) => s >= 0.6).length / scores.length;

    return {
      scores,
      meanScore: Number(meanScore.toFixed(4)),
      standardDeviation: Number(standardDeviation.toFixed(4)),
      passRate: Number(passRate.toFixed(4)),
    };
  }

  private calculateVariance(scores: number[]): number {
    if (scores.length === 0) return 0;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    return scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
  }
}
