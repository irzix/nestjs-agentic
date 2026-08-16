import type { AgentContext, AgentRunner } from '@nestjs-agentic/core';
import {
  RefinementBudgetExceededError,
  RefinementCheckpointVersionError,
} from '../errors';
import type {
  RefinementLoopBudget,
  RefinementLoopCheckpoint,
  RefinementLoopOptions,
  RefinementLoopResult,
  SatisfactionResult,
  SubAgentResult,
  SubAgentTask,
} from '../interfaces/orchestration.interface';
import { SubAgentDelegator } from '../delegator/sub-agent.delegator';

/**
 * Runner service for executing supervisor-worker iterative refinement loops with feedback evaluation,
 * versioned session memory, token/duration budget guardrails, and persistent checkpointing.
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
      budget: options?.budget,
      stateStore: options?.stateStore,
      checkpointTtlSeconds: options?.checkpointTtlSeconds ?? 86400,
    };
  }

  /**
   * Generates a unique checkpoint storage key scoped by tenant, session, and agent name.
   */
  private getCheckpointKey(parentContext: AgentContext, agentName: string): string {
    const tenantId = parentContext.security.tenantId ?? 'default';
    return `agentic:${tenantId}:refinement:${parentContext.sessionId}:${agentName}:checkpoint`;
  }

  /**
   * Runs an iterative refinement loop with feedback evaluation until satisfaction condition is met,
   * maxIterations is reached, or token/duration budgets are exhausted.
   */
  async runLoop(
    parentContext: AgentContext,
    initialTask: SubAgentTask,
    feedbackProviderFn?: (lastResult: SubAgentResult, iteration: number) => Promise<string> | string,
  ): Promise<RefinementLoopResult> {
    return this.executeLoopCore(parentContext, initialTask, {
      startIteration: 0,
      startMessage: initialTask.message,
      initialHistory: [],
      initialTokens: 0,
      initialDurationMs: 0,
      feedbackProviderFn,
    });
  }

  /**
   * Resumes an interrupted refinement loop directly from a saved RefinementLoopCheckpoint snapshot.
   */
  async resumeLoop(
    parentContext: AgentContext,
    checkpoint: RefinementLoopCheckpoint,
    feedbackProviderFn?: (lastResult: SubAgentResult, iteration: number) => Promise<string> | string,
  ): Promise<RefinementLoopResult> {
    if (checkpoint.version !== 1) {
      throw new RefinementCheckpointVersionError(checkpoint.version, 1);
    }

    const task: SubAgentTask = {
      agentName: checkpoint.agentName,
      message: checkpoint.currentMessage,
    };

    return this.executeLoopCore(parentContext, task, {
      startIteration: checkpoint.iteration,
      startMessage: checkpoint.currentMessage,
      initialHistory: [...checkpoint.history],
      initialTokens: checkpoint.totalTokens,
      initialDurationMs: checkpoint.totalDurationMs,
      feedbackProviderFn,
    });
  }

  /**
   * Recovers the latest saved RefinementLoopCheckpoint for the given agent and session from StateStore.
   */
  async recoverLatestCheckpoint(
    parentContext: AgentContext,
    agentName: string,
  ): Promise<RefinementLoopCheckpoint | null> {
    if (!this.options.stateStore) {
      return null;
    }
    const key = this.getCheckpointKey(parentContext, agentName);
    const checkpoint = await this.options.stateStore.get<RefinementLoopCheckpoint>(key);
    return checkpoint ?? null;
  }

  /**
   * Core execution engine managing loop rounds, budget checks, evaluators, and checkpointing.
   */
  private async executeLoopCore(
    parentContext: AgentContext,
    initialTask: SubAgentTask,
    state: {
      startIteration: number;
      startMessage: string;
      initialHistory: SubAgentResult[];
      initialTokens: number;
      initialDurationMs: number;
      feedbackProviderFn?: (lastResult: SubAgentResult, iteration: number) => Promise<string> | string;
    },
  ): Promise<RefinementLoopResult> {
    const history: SubAgentResult[] = [...state.initialHistory];
    let currentMessage = state.startMessage;
    let accumulatedTokens = state.initialTokens;
    let accumulatedDurationMs = state.initialDurationMs;
    let iteration = state.startIteration;
    let satisfied = false;
    let terminationReason: RefinementLoopResult['terminationReason'] = 'max_iterations';

    const activeSignal = initialTask.signal ?? this.options.signal ?? parentContext.signal;
    const maxIter = this.options.maxIterations ?? 3;
    const checkpointKey = this.getCheckpointKey(parentContext, initialTask.agentName);

    while (iteration < maxIter) {
      if (activeSignal?.aborted) {
        terminationReason = 'aborted';
        break;
      }

      // Check pre-iteration budget limits
      if (this.options.budget?.maxTotalTokens && accumulatedTokens >= this.options.budget.maxTotalTokens) {
        terminationReason = 'budget_exceeded';
        break;
      }
      if (this.options.budget?.maxTotalTimeMs && accumulatedDurationMs >= this.options.budget.maxTotalTimeMs) {
        terminationReason = 'budget_exceeded';
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

      accumulatedTokens += result.tokens?.totalTokens ?? 0;
      accumulatedDurationMs += result.durationMs ?? 0;

      if (result.status !== 'success') {
        terminationReason = 'error';
        // Persist checkpoint on failure for debugging/recovery
        if (this.options.stateStore) {
          await this.saveCheckpoint(checkpointKey, parentContext, initialTask.agentName, {
            iteration,
            maxIter,
            history,
            accumulatedTokens,
            accumulatedDurationMs,
            currentMessage,
          });
        }
        break;
      }

      // Satisfaction Evaluation
      let nextFeedback: string | undefined;
      if (this.options.satisfactionFn) {
        const evalResult = await this.options.satisfactionFn(result, iteration);
        if (typeof evalResult === 'boolean') {
          satisfied = evalResult;
        } else if (evalResult && typeof evalResult === 'object') {
          satisfied = evalResult.satisfied;
          if (evalResult.score !== undefined) {
            result.score = evalResult.score;
          }
          if (!satisfied && evalResult.feedback) {
            nextFeedback = evalResult.feedback;
          }
        }
      } else if (result.score !== undefined && this.options.qualityThreshold !== undefined) {
        satisfied = result.score >= this.options.qualityThreshold;
      } else {
        satisfied = true;
      }

      if (satisfied) {
        terminationReason = 'satisfied';
        // Clean up persisted checkpoint upon clean satisfaction
        if (this.options.stateStore) {
          await this.options.stateStore.delete(checkpointKey);
        }
        break;
      }

      // Check post-iteration budget limits
      if (this.options.budget?.maxTotalTokens && accumulatedTokens >= this.options.budget.maxTotalTokens) {
        terminationReason = 'budget_exceeded';
        break;
      }
      if (this.options.budget?.maxTotalTimeMs && accumulatedDurationMs >= this.options.budget.maxTotalTimeMs) {
        terminationReason = 'budget_exceeded';
        break;
      }

      if (iteration < maxIter) {
        if (nextFeedback) {
          currentMessage = nextFeedback;
        } else if (state.feedbackProviderFn) {
          currentMessage = await state.feedbackProviderFn(result, iteration);
        } else {
          currentMessage = `Refinement Feedback (Iteration ${iteration}): Please improve the quality of your previous output: "${result.response}"`;
        }

        // Persist checkpoint for in-flight iteration
        if (this.options.stateStore) {
          await this.saveCheckpoint(checkpointKey, parentContext, initialTask.agentName, {
            iteration,
            maxIter,
            history,
            accumulatedTokens,
            accumulatedDurationMs,
            currentMessage,
          });
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
      terminationReason,
      totalTokens: accumulatedTokens,
      totalDurationMs: accumulatedDurationMs,
    };
  }

  private async saveCheckpoint(
    key: string,
    parentContext: AgentContext,
    agentName: string,
    state: {
      iteration: number;
      maxIter: number;
      history: SubAgentResult[];
      accumulatedTokens: number;
      accumulatedDurationMs: number;
      currentMessage: string;
    },
  ): Promise<void> {
    if (!this.options.stateStore) return;
    const checkpoint: RefinementLoopCheckpoint = {
      version: 1,
      parentSessionId: parentContext.sessionId,
      tenantId: parentContext.security.tenantId,
      agentName,
      iteration: state.iteration,
      maxIterations: state.maxIter,
      history: [...state.history],
      totalTokens: state.accumulatedTokens,
      totalDurationMs: state.accumulatedDurationMs,
      currentMessage: state.currentMessage,
      savedAt: new Date().toISOString(),
    };
    await this.options.stateStore.set(key, checkpoint, this.options.checkpointTtlSeconds);
  }
}
