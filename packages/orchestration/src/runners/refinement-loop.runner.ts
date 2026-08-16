import type { AgentContext, AgentRunner } from '@nestjs-agentic/core';
import type { RefinementLoopOptions, SubAgentResult, SubAgentTask } from '../interfaces/orchestration.interface';
import { SubAgentDelegator } from '../delegator/sub-agent.delegator';

/**
 * Result payload returned from an iterative refinement loop run.
 */
export interface RefinementLoopResult {
  /** Final text response output generated upon loop termination. */
  finalResponse: string;

  /** Total number of refinement iterations executed. */
  iterations: number;

  /** Whether the loop satisfied the termination condition before maxIterations was reached. */
  satisfied: boolean;

  /** Chronological history of sub-agent results for each loop iteration. */
  history: SubAgentResult[];
}

/**
 * Runner service for executing supervisor-worker iterative refinement loops with feedback evaluation and versioned session memory.
 */
export class RefinementLoopRunner {
  private readonly delegator: SubAgentDelegator;
  private readonly options: RefinementLoopOptions;

  constructor(runner: AgentRunner, options?: RefinementLoopOptions) {
    this.delegator = new SubAgentDelegator(runner);
    this.options = {
      maxIterations: options?.maxIterations ?? 3,
      qualityThreshold: options?.qualityThreshold ?? 0.85,
      signal: options?.signal,
      satisfactionFn: options?.satisfactionFn,
    };
  }

  /**
   * Runs an iterative refinement loop with feedback evaluation until satisfaction condition is met or maxIterations is reached.
   */
  async runLoop(
    parentContext: AgentContext,
    initialTask: SubAgentTask,
    feedbackProviderFn?: (lastResult: SubAgentResult, iteration: number) => Promise<string> | string,
  ): Promise<RefinementLoopResult> {
    const history: SubAgentResult[] = [];
    let currentMessage = initialTask.message;
    let satisfied = false;
    let iteration = 0;
    const activeSignal = initialTask.signal ?? this.options.signal;

    const maxIter = this.options.maxIterations ?? 3;
    while (iteration < maxIter) {
      if (activeSignal?.aborted) {
        break;
      }

      iteration++;

      const task: SubAgentTask = {
        ...initialTask,
        message: currentMessage,
      };

      const result = await this.delegator.delegate(
        parentContext,
        task,
        iteration,
        activeSignal,
      );
      history.push(result);

      if (result.status !== 'success') {
        break;
      }

      if (this.options.satisfactionFn) {
        satisfied = await this.options.satisfactionFn(result, iteration);
      } else if (result.score !== undefined && this.options.qualityThreshold !== undefined) {
        satisfied = result.score >= this.options.qualityThreshold;
      } else {
        satisfied = true;
      }

      if (satisfied) {
        break;
      }

      if (iteration < maxIter) {
        if (feedbackProviderFn) {
          currentMessage = await feedbackProviderFn(result, iteration);
        } else {
          currentMessage = `Refinement Feedback (Iteration ${iteration}): Please improve the quality of your previous output: "${result.response}"`;
        }
      }
    }

    const lastSuccess = [...history].reverse().find((r) => r.status === 'success');
    const finalResponse = lastSuccess ? lastSuccess.response : (history[history.length - 1]?.error || '');

    return {
      finalResponse,
      iterations: history.length,
      satisfied,
      history,
    };
  }
}
