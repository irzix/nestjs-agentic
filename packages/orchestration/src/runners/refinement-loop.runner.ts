import type { AgentContext, AgentRunner } from '@nestjs-agentic/core';
import { scopeKey } from '@nestjs-agentic/core';
import {
  MissingFeedbackProviderError,
  RefinementBudgetExceededError,
  RefinementCheckpointConflictError,
  RefinementCheckpointVersionError,
  RefinementLoopAlreadyRunningError,
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
 * versioned session memory, token/duration budget guardrails, distributed lock protection, and persistent checkpointing.
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
      errorCheckpointTtlSeconds: options?.errorCheckpointTtlSeconds ?? 3600,
      lockTtlSeconds: options?.lockTtlSeconds ?? 60,
    };
  }

  /** Checkpoint storage key scoped by tenant, session, and agent name. */
  private getCheckpointKey(parentContext: AgentContext, agentName: string): string {
    return `agentic:refinement:checkpoint:${scopeKey(parentContext.security.tenantId, parentContext.sessionId, agentName)}`;
  }

  /** Concurrency lock key scoped by tenant, session, and agent name. */
  private getLockKey(parentContext: AgentContext, agentName: string): string {
    return `agentic:refinement:lock:${scopeKey(parentContext.security.tenantId, parentContext.sessionId, agentName)}`;
  }

  /**
   * Atomically acquires a distributed execution lease to prevent race conditions during concurrent loop execution or resumption.
   */
  private async acquireLock(parentContext: AgentContext, agentName: string): Promise<string | null> {
    if (!this.options.stateStore) return null;
    const lockKey = this.getLockKey(parentContext, agentName);
    const lockId = Math.random().toString(36).substring(2, 15);
    const lockTtl = this.options.lockTtlSeconds ?? 60;

    // Use atomic setIfNotExists (SETNX / INSERT ON CONFLICT) if supported by StateStore
    if (this.options.stateStore.setIfNotExists) {
      const acquired = await this.options.stateStore.setIfNotExists(lockKey, lockId, lockTtl);
      if (!acquired) {
        throw new RefinementLoopAlreadyRunningError(parentContext.sessionId, agentName);
      }
      return lockId;
    }

    // Fallback for custom StateStore implementations lacking setIfNotExists
    const existing = await this.options.stateStore.get<string>(lockKey);
    if (existing) {
      throw new RefinementLoopAlreadyRunningError(parentContext.sessionId, agentName);
    }
    await this.options.stateStore.set(lockKey, lockId, lockTtl);
    return lockId;
  }

  /**
   * Safely releases the concurrency execution lease, ensuring it only deletes the key if owned by this process.
   */
  private async releaseLock(
    parentContext: AgentContext,
    agentName: string,
    lockId: string | null,
  ): Promise<void> {
    if (!this.options.stateStore || !lockId) return;
    const lockKey = this.getLockKey(parentContext, agentName);
    try {
      const current = await this.options.stateStore.get<string>(lockKey);
      if (current === lockId) {
        await this.options.stateStore.delete(lockKey);
      }
    } catch {
      // Graceful error suppression during lock release
    }
  }

  /**
   * Runs an iterative refinement loop with feedback evaluation until satisfaction condition is met,
   * maxIterations is reached, or token/duration budgets are exhausted.
   */
  async run(
    parentContext: AgentContext,
    initialTask: SubAgentTask,
    feedbackProviderFn?: (lastResult: SubAgentResult, iteration: number) => Promise<string> | string,
  ): Promise<RefinementLoopResult> {
    const lockId = await this.acquireLock(parentContext, initialTask.agentName);
    try {
      return await this.execute(parentContext, initialTask, {
        startIteration: 0,
        startMessage: initialTask.message,
        initialHistory: [],
        initialTokens: 0,
        initialDurationMs: 0,
        initialSequence: 0,
        feedbackProviderFn,
      });
    } finally {
      await this.releaseLock(parentContext, initialTask.agentName, lockId);
    }
  }

  /**
   * Resumes an interrupted refinement loop directly from a saved RefinementLoopCheckpoint snapshot.
   */
  async resume(
    parentContext: AgentContext,
    checkpoint: RefinementLoopCheckpoint,
    feedbackProviderFn?: (lastResult: SubAgentResult, iteration: number) => Promise<string> | string,
  ): Promise<RefinementLoopResult> {
    if (checkpoint.version !== 1) {
      throw new RefinementCheckpointVersionError(checkpoint.version, 1);
    }

    if (checkpoint.feedbackSource === 'provider' && !feedbackProviderFn) {
      throw new MissingFeedbackProviderError(
        `Refinement loop checkpoint for session "${parentContext.sessionId}" was created with a custom feedbackProviderFn. ` +
          `You must provide a feedbackProviderFn when resuming this loop.`,
      );
    }

    const lockId = await this.acquireLock(parentContext, checkpoint.agentName);
    try {
      const task: SubAgentTask = {
        agentName: checkpoint.agentName,
        message: checkpoint.currentMessage,
      };

      return await this.execute(parentContext, task, {
        startIteration: checkpoint.iteration,
        startMessage: checkpoint.currentMessage,
        initialHistory: [...checkpoint.history],
        initialTokens: checkpoint.totalTokens,
        initialDurationMs: checkpoint.totalDurationMs,
        initialSequence: checkpoint.checkpointSequence ?? 0,
        feedbackProviderFn,
      });
    } finally {
      await this.releaseLock(parentContext, checkpoint.agentName, lockId);
    }
  }

  /**
   * Recovers the saved RefinementLoopCheckpoint for the given agent and session from StateStore.
   */
  async getCheckpoint(
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
  private async execute(
    parentContext: AgentContext,
    initialTask: SubAgentTask,
    state: {
      startIteration: number;
      startMessage: string;
      initialHistory: SubAgentResult[];
      initialTokens: number;
      initialDurationMs: number;
      initialSequence: number;
      feedbackProviderFn?: (lastResult: SubAgentResult, iteration: number) => Promise<string> | string;
    },
  ): Promise<RefinementLoopResult> {
    const history: SubAgentResult[] = [...state.initialHistory];
    let currentMessage = state.startMessage;
    let accumulatedTokens = state.initialTokens;
    let accumulatedDurationMs = state.initialDurationMs;
    let sequence = state.initialSequence;
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

      // Calculate remaining budget limits to bound the sub-agent execution dynamically
      let roundLimits = initialTask.narrowing?.limits;
      if (this.options.budget?.maxTotalTokens) {
        const remainingTokens = Math.max(0, this.options.budget.maxTotalTokens - accumulatedTokens);
        roundLimits = {
          ...roundLimits,
          maxTotalTokens: roundLimits?.maxTotalTokens
            ? Math.min(roundLimits.maxTotalTokens, remainingTokens)
            : remainingTokens,
        };
      }
      if (this.options.budget?.maxTotalTimeMs) {
        const remainingTimeMs = Math.max(0, this.options.budget.maxTotalTimeMs - accumulatedDurationMs);
        roundLimits = {
          ...roundLimits,
          timeoutMs: roundLimits?.timeoutMs
            ? Math.min(roundLimits.timeoutMs, remainingTimeMs)
            : remainingTimeMs,
        };
      }

      const task: SubAgentTask = {
        ...initialTask,
        message: currentMessage,
        narrowing: {
          ...initialTask.narrowing,
          limits: roundLimits,
        },
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
        sequence++;
        // Persist checkpoint on failure with shorter error TTL for debugging/recovery
        if (this.options.stateStore) {
          await this.saveCheckpoint(
            checkpointKey,
            parentContext,
            initialTask.agentName,
            {
              iteration,
              maxIter,
              history,
              accumulatedTokens,
              accumulatedDurationMs,
              currentMessage,
              feedbackSource: 'default',
              sequence,
            },
            this.options.errorCheckpointTtlSeconds ?? 3600,
          );
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
        let feedbackSource: 'provider' | 'evaluator' | 'default' = 'default';
        if (nextFeedback) {
          currentMessage = nextFeedback;
          feedbackSource = 'evaluator';
        } else if (state.feedbackProviderFn) {
          currentMessage = await state.feedbackProviderFn(result, iteration);
          feedbackSource = 'provider';
        } else {
          feedbackSource = 'default';
          const scoreInfo = result.score !== undefined
            ? ` (Score: ${(result.score * 100).toFixed(1)}% / Threshold: ${((this.options.qualityThreshold ?? 0.85) * 100).toFixed(1)}%)`
            : '';
          const prevSnippet = result.response.length > 300
            ? `${result.response.substring(0, 300)}...`
            : result.response;

          currentMessage =
            `Refinement Feedback (Iteration ${iteration}/${maxIter}):\n` +
            `Your previous output did not meet the required quality criteria${scoreInfo}.\n` +
            `Please revise and improve the response by addressing:\n` +
            `1. Accuracy, completeness, and adherence to domain standards.\n` +
            `2. Structural clarity and actionable details.\n\n` +
            `Previous output to improve:\n` +
            `"""\n${prevSnippet}\n"""`;
        }

        sequence++;
        // Persist checkpoint for in-flight iteration
        if (this.options.stateStore) {
          await this.saveCheckpoint(
            checkpointKey,
            parentContext,
            initialTask.agentName,
            {
              iteration,
              maxIter,
              history,
              accumulatedTokens,
              accumulatedDurationMs,
              currentMessage,
              feedbackSource,
              sequence,
            },
            this.options.checkpointTtlSeconds,
          );
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
      feedbackSource: 'provider' | 'evaluator' | 'default';
      sequence: number;
    },
    ttlSeconds?: number,
  ): Promise<void> {
    if (!this.options.stateStore) return;

    // Optimistic Concurrency Control (OCC) check: forbid overwriting a higher sequence checkpoint
    const existing = await this.options.stateStore.get<RefinementLoopCheckpoint>(key);
    if (
      existing &&
      existing.checkpointSequence !== undefined &&
      existing.checkpointSequence >= state.sequence
    ) {
      throw new RefinementCheckpointConflictError(key, state.sequence, existing.checkpointSequence);
    }

    const checkpoint: RefinementLoopCheckpoint = {
      version: 1,
      checkpointSequence: state.sequence,
      parentSessionId: parentContext.sessionId,
      tenantId: parentContext.security.tenantId,
      agentName,
      iteration: state.iteration,
      maxIterations: state.maxIter,
      history: [...state.history],
      totalTokens: state.accumulatedTokens,
      totalDurationMs: state.accumulatedDurationMs,
      currentMessage: state.currentMessage,
      feedbackSource: state.feedbackSource,
      savedAt: new Date().toISOString(),
    };
    await this.options.stateStore.set(key, checkpoint, ttlSeconds ?? this.options.checkpointTtlSeconds);
  }
}
