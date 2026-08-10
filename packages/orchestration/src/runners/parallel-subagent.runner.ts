import type { AgentRunner } from '@nestjs-agentic/core';
import type { ParallelRunnerOptions, SubAgentResult, SubAgentTask } from '../interfaces/orchestration.interface';
import { ParentSecurityContext, SubAgentDelegator } from '../delegator/sub-agent.delegator';

export interface ParallelRunResult {
  combinedResponse: string;
  results: SubAgentResult[];
  successCount: number;
  failedCount: number;
}

export class ParallelSubAgentRunner {
  private readonly delegator: SubAgentDelegator;
  private readonly options: ParallelRunnerOptions;

  constructor(runner: AgentRunner, options?: ParallelRunnerOptions) {
    this.delegator = new SubAgentDelegator(runner);
    this.options = {
      aggregationStrategy: options?.aggregationStrategy ?? 'allSettled',
      timeoutMs: options?.timeoutMs ?? 30000,
      customMergerFn: options?.customMergerFn,
    };
  }

  /**
   * Executes multiple sub-agents in parallel and aggregates their responses.
   */
  async runParallel(
    parentSessionId: string,
    parentSecurityContext: ParentSecurityContext,
    tasks: SubAgentTask[],
  ): Promise<ParallelRunResult> {
    if (!tasks || tasks.length === 0) {
      return { combinedResponse: '', results: [], successCount: 0, failedCount: 0 };
    }

    // Wrap delegation with timeout
    const executeTaskWithTimeout = async (task: SubAgentTask): Promise<SubAgentResult> => {
      let timer: NodeJS.Timeout;
      const timeoutPromise = new Promise<SubAgentResult>((resolve) => {
        timer = setTimeout(() => {
          resolve({
            agentName: task.agentName,
            status: 'failed',
            response: '',
            toolCount: 0,
            error: `Sub-agent ${task.agentName} timed out after ${this.options.timeoutMs}ms`,
          });
        }, this.options.timeoutMs);
      });

      try {
        const result = await Promise.race([
          this.delegator.delegate(parentSessionId, parentSecurityContext, task),
          timeoutPromise,
        ]);
        return result;
      } finally {
        clearTimeout(timer!);
      }
    };

    const taskPromises = tasks.map((task) => executeTaskWithTimeout(task));
    const results = await Promise.all(taskPromises);

    const successCount = results.filter((r) => r.status === 'success').length;
    const failedCount = results.length - successCount;

    let combinedResponse = '';

    if (this.options.customMergerFn) {
      combinedResponse = await this.options.customMergerFn(results);
    } else if (this.options.aggregationStrategy === 'firstSuccess') {
      const first = results.find((r) => r.status === 'success');
      combinedResponse = first?.response || '';
    } else if (this.options.aggregationStrategy === 'consensusMerge') {
      // Concatenate valid responses
      combinedResponse = results
        .filter((r) => r.status === 'success')
        .map((r) => `[${r.agentName}]: ${r.response}`)
        .join('\n\n');
    } else {
      // Default: allSettled summary
      combinedResponse = results
        .map((r) => {
          if (r.status === 'success') {
            return `[${r.agentName} SUCCESS]: ${r.response}`;
          }
          return `[${r.agentName} FAILED]: ${r.error}`;
        })
        .join('\n\n');
    }

    return {
      combinedResponse,
      results,
      successCount,
      failedCount,
    };
  }
}
