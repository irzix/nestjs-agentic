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
      retriesPerSubAgent: options?.retriesPerSubAgent ?? 1,
      fallbackAgentName: options?.fallbackAgentName,
      customMergerFn: options?.customMergerFn,
    };
  }

  /**
   * Executes multiple sub-agents in parallel with retries, fallback recovery, and score-weighted consensus aggregation.
   */
  async runParallel(
    parentSessionId: string,
    parentSecurityContext: ParentSecurityContext,
    tasks: SubAgentTask[],
  ): Promise<ParallelRunResult> {
    if (!tasks || tasks.length === 0) {
      return { combinedResponse: '', results: [], successCount: 0, failedCount: 0 };
    }

    const executeTaskWithRetryAndFallback = async (task: SubAgentTask): Promise<SubAgentResult> => {
      let attempts = 0;
      let lastResult: SubAgentResult | null = null;
      const maxAttempts = (this.options.retriesPerSubAgent ?? 1) + 1;

      while (attempts < maxAttempts) {
        attempts++;

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
          lastResult = await Promise.race([
            this.delegator.delegate(parentSessionId, parentSecurityContext, task),
            timeoutPromise,
          ]);
        } finally {
          clearTimeout(timer!);
        }

        if (lastResult.status === 'success') {
          return lastResult;
        }
      }

      // If primary agent failed all retries, attempt fallback sub-agent if configured
      if (this.options.fallbackAgentName && this.options.fallbackAgentName !== task.agentName) {
        const fallbackTask: SubAgentTask = {
          ...task,
          agentName: this.options.fallbackAgentName,
        };

        const fallbackResult = await this.delegator.delegate(parentSessionId, parentSecurityContext, fallbackTask);
        if (fallbackResult.status === 'success') {
          return {
            ...fallbackResult,
            response: `[Fallback Agent ${this.options.fallbackAgentName}]: ${fallbackResult.response}`,
          };
        }
      }

      return lastResult!;
    };

    const results = await Promise.all(tasks.map((t) => executeTaskWithRetryAndFallback(t)));
    const successCount = results.filter((r) => r.status === 'success').length;
    const failedCount = results.length - successCount;

    let combinedResponse = '';

    if (this.options.customMergerFn) {
      combinedResponse = await this.options.customMergerFn(results);
    } else if (this.options.aggregationStrategy === 'firstSuccess') {
      const first = results.find((r) => r.status === 'success');
      combinedResponse = first?.response || '';
    } else if (this.options.aggregationStrategy === 'consensusMerge') {
      // Score-Weighted Consensus Merge
      const validResults = results.filter((r) => r.status === 'success');
      if (validResults.length === 0) {
        combinedResponse = 'All sub-agents failed to return valid results.';
      } else {
        // Sort by confidence score if available
        validResults.sort((a, b) => (b.score || 0) - (a.score || 0));
        combinedResponse = validResults.map((r) => `[${r.agentName}]: ${r.response}`).join('\n\n');
      }
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
