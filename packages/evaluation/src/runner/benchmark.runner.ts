import type { AgentRunner } from '@nestjs-agentic/core';
import type {
  BenchmarkSummary,
  EvalDatasetItem,
  EvalItemResult,
  EvalMetric,
  MetricResult,
} from '../interfaces/evaluation.interface';
import { SafetyPolicyMetric } from '../metrics/safety-policy.metric';
import { AccuracyGroundTruthMetric } from '../metrics/accuracy.metric';
import { EfficiencyMetric } from '../metrics/efficiency.metric';

export interface BenchmarkRunnerOptions {
  metrics?: EvalMetric[];
}

export class BenchmarkRunner {
  private readonly metrics: EvalMetric[];

  constructor(private readonly runner: AgentRunner, options?: BenchmarkRunnerOptions) {
    this.metrics = options?.metrics || [
      new SafetyPolicyMetric(),
      new AccuracyGroundTruthMetric(),
      new EfficiencyMetric(),
    ];
  }

  /**
   * Runs a benchmark dataset suite across the target AgentRunner and evaluates all metric scores.
   */
  async runBenchmark(agentName: string, dataset: EvalDatasetItem[]): Promise<BenchmarkSummary> {
    const itemResults: EvalItemResult[] = [];

    for (const item of dataset) {
      const sessionId = `eval_${agentName}_${item.id}`;

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

        itemResults.push({
          item,
          agentResult,
          metrics: metricResults,
          overallPassed,
          score: Number(itemScore.toFixed(2)),
        });
      } catch (err: any) {
        itemResults.push({
          item,
          agentResult: {
            sessionId,
            output: '',
            toolCalls: [],
          },
          metrics: [
            {
              metricName: 'ExecutionError',
              passed: false,
              score: 0.0,
              reason: err?.message || 'Agent execution threw an exception',
            },
          ],
          overallPassed: false,
          score: 0.0,
        });
      }
    }

    const passedItems = itemResults.filter((r) => r.overallPassed).length;
    const failedItems = itemResults.length - passedItems;
    const passRate = itemResults.length ? passedItems / itemResults.length : 0;
    const averageScore = itemResults.length
      ? itemResults.reduce((sum, r) => sum + r.score, 0) / itemResults.length
      : 0;

    return {
      totalItems: itemResults.length,
      passedItems,
      failedItems,
      passRate: Number(passRate.toFixed(2)),
      averageScore: Number(averageScore.toFixed(2)),
      itemResults,
    };
  }
}
