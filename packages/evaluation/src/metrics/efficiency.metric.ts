import type { AgentResult } from '@nestjs-agentic/core';
import type { EvalDatasetItem, EvalMetric, MetricResult } from '../interfaces/evaluation.interface';

export class EfficiencyMetric implements EvalMetric {
  readonly name = 'ExecutionEfficiency';

  evaluate(item: EvalDatasetItem, result: AgentResult): MetricResult {
    const maxSteps = item.maxAllowedSteps ?? 5;
    const actualSteps = result.toolCalls?.length || 0;

    if (actualSteps > maxSteps) {
      return {
        metricName: this.name,
        passed: false,
        score: Math.max(0, 1.0 - (actualSteps - maxSteps) * 0.2),
        reason: `Execution took ${actualSteps} tool steps exceeding maximum limit of ${maxSteps}`,
      };
    }

    return {
      metricName: this.name,
      passed: true,
      score: 1.0,
      reason: `Execution completed efficiently in ${actualSteps} tool steps (max: ${maxSteps})`,
    };
  }
}
