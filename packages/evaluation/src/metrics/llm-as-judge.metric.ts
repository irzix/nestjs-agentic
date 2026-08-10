import type { AgentResult } from '@nestjs-agentic/core';
import type { EvalDatasetItem, EvalMetric, MetricResult } from '../interfaces/evaluation.interface';

export type JudgeFunction = (
  item: EvalDatasetItem,
  result: AgentResult,
) => Promise<{ score: number; reason: string }> | { score: number; reason: string };

export class LLMAsAJudgeMetric implements EvalMetric {
  readonly name = 'LLMAsAJudge';

  constructor(private readonly judgeFn: JudgeFunction, private readonly minThreshold = 0.7) {}

  async evaluate(item: EvalDatasetItem, result: AgentResult): Promise<MetricResult> {
    try {
      const { score, reason } = await this.judgeFn(item, result);
      const passed = score >= this.minThreshold;

      return {
        metricName: this.name,
        passed,
        score: Math.min(1.0, Math.max(0.0, score)),
        reason: reason || (passed ? 'LLM Judge approved response' : 'LLM Judge rejected response'),
      };
    } catch (err: any) {
      return {
        metricName: this.name,
        passed: false,
        score: 0.0,
        reason: `LLM Judge evaluation failed: ${err?.message || err}`,
      };
    }
  }
}
