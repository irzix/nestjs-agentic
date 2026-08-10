import type { AgentRunner } from '@nestjs-agentic/core';
import type { RefinementLoopOptions, SubAgentResult, SubAgentTask } from '../interfaces/orchestration.interface';
import { ParentSecurityContext, SubAgentDelegator } from '../delegator/sub-agent.delegator';

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

  /**
   * Creates a new instance of RefinementLoopRunner.
   * @param runner Core AgentRunner instance.
   * @param options Configuration options for refinement loop execution.
   */
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
   *
   * @param parentSessionId Parent session identifier.
   * @param parentSecurityContext Inherited parent security context.
   * @param initialTask Initial sub-agent task payload.
   * @param feedbackProviderFn Optional function providing feedback instructions for subsequent iterations.
   * @returns Promise resolving to the final refinement loop result.
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

      const result = await this.delegator.delegate(parentSessionId, parentSecurityContext, task, iteration);
      history.push(result);

      if (result.status !== 'success') {
        break;
      }

      if (this.options.satisfactionFn) {
        satisfied = await this.options.satisfactionFn!(result, iteration);
      } else if (result.score !== undefined && this.options.qualityThreshold !== undefined) {
        satisfied = result.score >= this.options.qualityThreshold;
      } else {
        satisfied = true;
      }

      if (satisfied) {
        break;
      }

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
