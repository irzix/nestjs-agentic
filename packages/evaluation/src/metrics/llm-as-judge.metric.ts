import type { AgentResult } from '@nestjs-agentic/core';
import type { EvalDatasetItem, EvalMetric, MetricResult } from '../interfaces/evaluation.interface';

/**
 * Function type for invoking an LLM-as-a-Judge model to evaluate an agent response trajectory.
 */
export type JudgeFunction = (
  item: EvalDatasetItem,
  result: AgentResult,
) => Promise<{ score: number; reason: string }> | { score: number; reason: string };

/**
 * Metric evaluator leveraging an LLM judge function to score response fluency, helpfulness, and policy compliance.
 */
export class LLMAsAJudgeMetric implements EvalMetric {
  readonly name = 'LLMAsAJudge';

  /**
   * Creates a new instance of LLMAsAJudgeMetric.
   * @param judgeFn Function that invokes the LLM judge and returns a score and reason.
   * @param minThreshold Minimum score threshold required to pass (0.0 to 1.0). Default: `0.7`
   */
  constructor(private readonly judgeFn: JudgeFunction, private readonly minThreshold = 0.7) {}

  /**
   * Evaluates the agent execution result using the LLM judge function.
   */
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        metricName: this.name,
        passed: false,
        score: 0.0,
        reason: `LLM Judge evaluation failed: ${message}`,
      };
    }
  }
}
