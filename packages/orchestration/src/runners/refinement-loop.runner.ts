import type { AgentRunner } from '@nestjs-agentic/core';
import type { RefinementLoopOptions, SubAgentResult, SubAgentTask } from '../interfaces/orchestration.interface';
import { ParentSecurityContext, SubAgentDelegator } from '../delegator/sub-agent.delegator';

export interface RefinementLoopResult {
  finalResponse: string;
  iterations: number;
  satisfied: boolean;
  history: SubAgentResult[];
}

export class RefinementLoopRunner {
  private readonly delegator: SubAgentDelegator;
  private readonly options: RefinementLoopOptions;

  constructor(runner: AgentRunner, options?: RefinementLoopOptions) {
    this.delegator = new SubAgentDelegator(runner);
    this.options = {
      maxIterations: options?.maxIterations ?? 3,
      qualityThreshold: options?.qualityThreshold ?? 0.85,
      satisfactionFn: options?.satisfactionFn,
    };
  }

  /**
   * Runs an iterative refinement loop with feedback evaluation until satisfaction condition is met or maxIterations is reached.
   */
  async runLoop(
    parentSessionId: string,
    parentSecurityContext: ParentSecurityContext,
    initialTask: SubAgentTask,
    feedbackProviderFn?: (lastResult: SubAgentResult, iteration: number) => Promise<string> | string,
  ): Promise<RefinementLoopResult> {
    const history: SubAgentResult[] = [];
    let currentMessage = initialTask.message;
    let satisfied = false;
    let iteration = 0;

    const maxIter = this.options.maxIterations ?? 3;
    while (iteration < maxIter) {
      iteration++;

      const task: SubAgentTask = {
        ...initialTask,
        message: currentMessage,
      };

      const result = await this.delegator.delegate(parentSessionId, parentSecurityContext, task);
      history.push(result);

      if (result.status !== 'success') {
        break;
      }

      // Check satisfaction condition
      if (this.options.satisfactionFn) {
        satisfied = await this.options.satisfactionFn!(result, iteration);
      } else if (result.score !== undefined && this.options.qualityThreshold !== undefined) {
        satisfied = result.score >= this.options.qualityThreshold;
      } else {
        // Default: first successful run satisfies loop if no custom evaluator or score is set
        satisfied = true;
      }

      if (satisfied) {
        break;
      }

      // Generate refinement feedback for next iteration loop
      if (feedbackProviderFn) {
        const feedback = await feedbackProviderFn(result, iteration);
        currentMessage = `${initialTask.message}\n\n[Previous Attempt #${iteration} Output]:\n${result.response}\n\n[Refinement Feedback]:\n${feedback}`;
      } else {
        currentMessage = `${initialTask.message}\n\n[Previous Attempt #${iteration} Output]:\n${result.response}\n\nPlease refine and improve the response.`;
      }
    }

    const lastResult = history[history.length - 1];

    return {
      finalResponse: lastResult?.response || '',
      iterations: iteration,
      satisfied,
      history,
    };
  }
}
