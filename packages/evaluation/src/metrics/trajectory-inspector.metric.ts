import type { AgentResult } from '@nestjs-agentic/core';
import type { EvalDatasetItem, EvalMetric, MetricResult } from '../interfaces/evaluation.interface';

/**
 * Metric evaluator that inspects the agent's tool call trajectory sequence and verifies argument schema assertions.
 */
export class TrajectoryInspectorMetric implements EvalMetric {
  readonly name = 'TrajectoryInspector';

  /**
   * Evaluates the tool call trajectory sequence and verifies tool argument values.
   */
  evaluate(item: EvalDatasetItem, result: AgentResult): MetricResult {
    const toolCalls = result.toolCalls || [];
    const actualSequence = toolCalls.map((t) => t.toolName);

    if (item.expectedToolSequence && item.expectedToolSequence.length > 0) {
      const expected = item.expectedToolSequence;
      let sequenceMatchCount = 0;

      for (let i = 0; i < expected.length; i++) {
        if (actualSequence[i] === expected[i]) {
          sequenceMatchCount++;
        }
      }

      const sequenceScore = sequenceMatchCount / expected.length;

      if (sequenceScore < 1.0) {
        return {
          metricName: this.name,
          passed: false,
          score: Number(sequenceScore.toFixed(4)),
          reason: `Tool sequence mismatch. Expected [${expected.join(' -> ')}], got [${actualSequence.join(' -> ')}]`,
          details: { actualSequence, expectedSequence: expected },
        };
      }
    }

    if (item.expectedToolArgs) {
      for (const [toolName, expectedArgs] of Object.entries(item.expectedToolArgs)) {
        const matchingCalls = toolCalls.filter((t) => t.toolName === toolName);

        if (matchingCalls.length === 0) {
          return {
            metricName: this.name,
            passed: false,
            score: 0.0,
            reason: `Expected tool "${toolName}" was not called in trajectory`,
          };
        }

        for (const call of matchingCalls) {
          for (const [argKey, expectedValue] of Object.entries(expectedArgs)) {
            const actualValue = call.args?.[argKey];
            if (actualValue !== expectedValue) {
              return {
                metricName: this.name,
                passed: false,
                score: 0.5,
                reason: `Tool "${toolName}" argument "${argKey}" mismatch. Expected "${expectedValue}", got "${actualValue}"`,
                details: { toolName, argKey, expectedValue, actualValue },
              };
            }
          }
        }
      }
    }

    return {
      metricName: this.name,
      passed: true,
      score: 1.0,
      reason: 'Agent trajectory sequence and argument assertions verified successfully',
      details: { actualSequence },
    };
  }
}
