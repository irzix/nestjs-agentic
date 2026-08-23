import type { AgentContext, AgentRunner } from '@nestjs-agentic/core';
import { scopeKey } from '@nestjs-agentic/core';
import {
  SopGuardFailedError,
  SopMaxTransitionsExceededError,
  SopPhaseExecutionError,
} from '../errors';
import type {
  SopContext,
  SopPhase,
  SopPhaseResult,
  SopRunResult,
  SopRunnerOptions,
  SopWorkflowCheckpoint,
  SubAgentResult,
  SubAgentTask,
} from '../interfaces/orchestration.interface';
import { SubAgentDelegator } from '../delegator/sub-agent.delegator';

/** Internal safety limit: max phases visited per workflow run to prevent infinite cycles. */
const MAX_PHASES_VISITED = 256;

/**
 * Runner service implementing MetaGPT-inspired Standard Operating Procedures (SOP) state machines.
 *
 * Executes an ordered list of `SopPhase` definitions sequentially. Each phase receives a
 * dynamically-built prompt derived from the accumulated `SopContext` of all prior phases.
 * Guard functions gate phase-to-phase transitions with automatic retries for transient issues.
 * Full checkpoint persistence and resumption prevents duplicate execution across process crashes.
 * Capability narrowing is strictly isolated and applied per-phase.
 *
 * @see Hong et al., "MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework"
 *      (DeepWisdom, ICLR 2024, arXiv:2308.00352)
 */
export class SopRunner {
  private readonly delegator: SubAgentDelegator;
  private readonly options: {
    timeoutMs: number;
    retriesPerPhase: number;
    signal?: AbortSignal;
    stateStore?: SopRunnerOptions['stateStore'];
    checkpointTtlSeconds: number;
  };

  constructor(runner: AgentRunner, options?: SopRunnerOptions) {
    this.delegator = new SubAgentDelegator(runner);
    this.options = {
      timeoutMs: options?.timeoutMs ?? 30000,
      retriesPerPhase: options?.retriesPerPhase ?? 1,
      signal: options?.signal,
      stateStore: options?.stateStore,
      checkpointTtlSeconds: options?.checkpointTtlSeconds ?? 86400,
    };
  }

  /** Checkpoint storage key scoped by tenant and session ID. */
  private getCheckpointKey(parentContext: AgentContext): string {
    return `agentic:sop:checkpoint:${scopeKey(parentContext.security.tenantId, parentContext.sessionId)}`;
  }

  /**
   * Recovers the saved `SopWorkflowCheckpoint` for the given session from StateStore.
   */
  async getCheckpoint(parentContext: AgentContext): Promise<SopWorkflowCheckpoint | null> {
    if (!this.options.stateStore) return null;
    const key = this.getCheckpointKey(parentContext);
    const checkpoint = await this.options.stateStore.get<SopWorkflowCheckpoint>(key);
    return checkpoint ?? null;
  }

  /**
   * Executes an ordered SOP workflow over the provided phases from the beginning.
   */
  async run(
    parentContext: AgentContext,
    phases: SopPhase[],
    initialData?: Record<string, unknown>,
  ): Promise<SopRunResult> {
    return this.executePhases(parentContext, phases, {
      completedPhases: [],
      startOutput: undefined,
      data: initialData ?? {},
    });
  }

  /**
   * Resumes an interrupted SOP workflow directly from a saved `SopWorkflowCheckpoint`.
   * Automatically skips already-completed phases to prevent duplicate execution.
   */
  async resume(
    parentContext: AgentContext,
    phases: SopPhase[],
    checkpoint?: SopWorkflowCheckpoint,
  ): Promise<SopRunResult> {
    const activeCheckpoint = checkpoint ?? (await this.getCheckpoint(parentContext));
    if (!activeCheckpoint) {
      // If no checkpoint found, start fresh run
      return this.run(parentContext, phases);
    }

    const completedNames = new Set(activeCheckpoint.completedPhases.map((p) => p.phaseName));
    const remainingPhases = phases.filter((p) => !completedNames.has(p.name));

    return this.executePhases(parentContext, remainingPhases, {
      completedPhases: [...activeCheckpoint.completedPhases],
      startOutput: activeCheckpoint.lastOutput,
      data: activeCheckpoint.data ?? {},
    });
  }

  /**
   * Core workflow execution loop.
   */
  private async executePhases(
    parentContext: AgentContext,
    phasesToRun: SopPhase[],
    initialState: {
      completedPhases: SopPhaseResult[];
      startOutput?: string;
      data: Record<string, unknown>;
    },
  ): Promise<SopRunResult> {
    if (phasesToRun.length === 0 && initialState.completedPhases.length === 0) {
      return {
        phases: [],
        finalOutput: '',
        requiresHumanReview: false,
        terminationReason: 'completed',
      };
    }

    if (this.options.signal?.aborted) {
      return {
        phases: initialState.completedPhases,
        finalOutput: initialState.startOutput ?? '',
        requiresHumanReview: false,
        terminationReason: 'aborted',
      };
    }

    const completedPhases: SopPhaseResult[] = [...initialState.completedPhases];
    let phasesVisited = completedPhases.length;

    const ctx: SopContext = {
      phaseHistory: completedPhases,
      lastOutput: initialState.startOutput,
      data: initialState.data,
    };

    for (const phase of phasesToRun) {
      phasesVisited++;
      if (phasesVisited > MAX_PHASES_VISITED) {
        throw new SopMaxTransitionsExceededError(phasesVisited, MAX_PHASES_VISITED);
      }

      if (this.options.signal?.aborted) {
        return this.buildResult(completedPhases, 'aborted', false);
      }

      // Execute phase with retry & guard evaluation
      const phaseStart = Date.now();
      const phaseOutcome = await this.executePhaseWithGuardRetries(parentContext, phase, ctx);
      const durationMs = Date.now() - phaseStart;

      const phaseResult: SopPhaseResult = {
        phaseName: phase.name,
        result: phaseOutcome.lastResult,
        durationMs,
      };

      if (phaseOutcome.aborted) {
        return this.buildResult(completedPhases, 'aborted', false);
      }

      if (!phaseOutcome.success) {
        completedPhases.push(phaseResult);
        if (phaseOutcome.guardFailed) {
          const guardError = new SopGuardFailedError(phase.name, phase.agentName);
          return {
            phases: completedPhases,
            finalOutput: phaseOutcome.lastResult.response,
            requiresHumanReview: true,
            terminationReason: 'guard_failed',
            error: guardError.message,
          };
        }

        throw new SopPhaseExecutionError(
          phase.name,
          phase.agentName,
          phaseOutcome.lastResult.error ?? 'Unknown execution error',
        );
      }

      completedPhases.push(phaseResult);
      ctx.lastOutput = phaseOutcome.lastResult.response;
      ctx.phaseHistory = [...completedPhases];

      // Checkpoint state after successfully completing phase
      await this.savePhaseCheckpoint(parentContext, completedPhases, ctx.lastOutput, ctx.data);
    }

    return this.buildResult(completedPhases, 'completed', false);
  }

  // ---------------------------------------------------------------------------
  // Phase execution with retries & guard evaluation
  // ---------------------------------------------------------------------------

  private async executePhaseWithGuardRetries(
    parentContext: AgentContext,
    phase: SopPhase,
    ctx: SopContext,
  ): Promise<{
    success: boolean;
    lastResult: SubAgentResult;
    guardFailed: boolean;
    aborted: boolean;
  }> {
    const maxAttempts = this.options.retriesPerPhase + 1;
    let lastResult: SubAgentResult | null = null;
    let guardFailed = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.options.signal?.aborted) {
        return {
          success: false,
          lastResult: {
            agentName: phase.agentName,
            status: 'failed',
            response: '',
            toolCount: 0,
            error: 'Execution was aborted',
          },
          guardFailed: false,
          aborted: true,
        };
      }

      const message = phase.buildMessage(ctx);
      const task: SubAgentTask = {
        agentName: phase.agentName,
        message,
        narrowing: phase.narrowing,
        signal: this.options.signal,
      };

      lastResult = await this.executeWithTimeout(parentContext, task);

      if (this.options.signal?.aborted || lastResult.error === 'Execution was aborted') {
        return { success: false, lastResult, guardFailed: false, aborted: true };
      }

      if (lastResult.status === 'success') {
        // Evaluate guard function if defined
        if (phase.guard) {
          const guardPassed = phase.guard(lastResult);
          if (guardPassed) {
            return { success: true, lastResult, guardFailed: false, aborted: false };
          }
          // Guard returned false — note failure and attempt retry if available
          guardFailed = true;
        } else {
          return { success: true, lastResult, guardFailed: false, aborted: false };
        }
      }
    }

    return {
      success: false,
      lastResult: lastResult ?? {
        agentName: phase.agentName,
        status: 'failed',
        response: '',
        toolCount: 0,
        error: `Phase "${phase.name}" failed after ${maxAttempts} attempt(s)`,
      },
      guardFailed,
      aborted: false,
    };
  }

  private async executeWithTimeout(
    parentContext: AgentContext,
    task: SubAgentTask,
  ): Promise<SubAgentResult> {
    let timer: NodeJS.Timeout | undefined;
    let abortHandler: (() => void) | undefined;
    const activeSignal = this.options.signal;

    const timeoutPromise = new Promise<SubAgentResult>((resolve) => {
      timer = setTimeout(() => {
        resolve({
          agentName: task.agentName,
          status: 'failed',
          response: '',
          toolCount: 0,
          error: `Phase sub-agent "${task.agentName}" timed out after ${this.options.timeoutMs}ms`,
        });
      }, this.options.timeoutMs);
    });

    const abortPromise = new Promise<SubAgentResult>((resolve) => {
      if (activeSignal?.aborted) {
        resolve({
          agentName: task.agentName,
          status: 'failed',
          response: '',
          toolCount: 0,
          error: 'Execution was aborted',
        });
        return;
      }
      if (activeSignal) {
        abortHandler = () =>
          resolve({
            agentName: task.agentName,
            status: 'failed',
            response: '',
            toolCount: 0,
            error: 'Execution was aborted',
          });
        activeSignal.addEventListener('abort', abortHandler, { once: true });
        // Microtask race double-check
        if (activeSignal.aborted) {
          abortHandler();
        }
      }
    });

    try {
      return await Promise.race([
        this.delegator.delegate(parentContext, task, undefined, activeSignal),
        timeoutPromise,
        abortPromise,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      if (activeSignal && abortHandler) activeSignal.removeEventListener('abort', abortHandler);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildResult(
    phases: SopPhaseResult[],
    terminationReason: SopRunResult['terminationReason'],
    requiresHumanReview: boolean,
  ): SopRunResult {
    const finalOutput = phases.length > 0 ? phases[phases.length - 1].result.response : '';
    return { phases, finalOutput, requiresHumanReview, terminationReason };
  }

  private async savePhaseCheckpoint(
    parentContext: AgentContext,
    completedPhases: SopPhaseResult[],
    lastOutput?: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.options.stateStore) return;
    const key = this.getCheckpointKey(parentContext);
    const checkpoint: SopWorkflowCheckpoint = {
      version: 1,
      sessionId: parentContext.sessionId,
      tenantId: parentContext.security.tenantId,
      completedPhases: [...completedPhases],
      lastOutput,
      data,
      savedAt: new Date().toISOString(),
    };
    await this.options.stateStore.set(key, checkpoint, this.options.checkpointTtlSeconds);
  }
}
