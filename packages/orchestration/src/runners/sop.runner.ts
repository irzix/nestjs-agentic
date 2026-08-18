import type { AgentContext, AgentRunner } from '@nestjs-agentic/core';
import { SopGuardFailedError, SopMaxTransitionsExceededError, SopPhaseExecutionError } from '../errors';
import type {
  SopContext,
  SopPhase,
  SopPhaseResult,
  SopRunResult,
  SopRunnerOptions,
  SubAgentResult,
  SubAgentTask,
} from '../interfaces/orchestration.interface';
import { SubAgentDelegator } from '../delegator/sub-agent.delegator';

/** Internal safety limit: max phases visitied per workflow run to prevent infinite cycles. */
const MAX_PHASES_VISITED = 256;

/**
 * Runner service implementing MetaGPT-inspired Standard Operating Procedures (SOP) state machines.
 *
 * Executes an ordered list of `SopPhase` definitions sequentially. Each phase receives a
 * dynamically-built prompt derived from the accumulated `SopContext` of all prior phases.
 * Guard functions gate phase-to-phase transitions; a failed guard halts the workflow and
 * sets `requiresHumanReview: true`. Capability narrowing is applied per-phase.
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

  /**
   * Executes an ordered SOP workflow over the provided phases.
   *
   * @param parentContext - Parent agent context for tenant isolation and trace propagation.
   * @param phases - Ordered array of `SopPhase` definitions.
   * @param initialData - Optional shared metadata injected into the initial `SopContext`.
   * @returns `SopRunResult` containing all phase results and termination metadata.
   */
  async run(
    parentContext: AgentContext,
    phases: SopPhase[],
    initialData?: Record<string, unknown>,
  ): Promise<SopRunResult> {
    if (phases.length === 0) {
      return {
        phases: [],
        finalOutput: '',
        requiresHumanReview: false,
        terminationReason: 'completed',
      };
    }

    if (this.options.signal?.aborted) {
      return {
        phases: [],
        finalOutput: '',
        requiresHumanReview: false,
        terminationReason: 'aborted',
      };
    }

    const completedPhases: SopPhaseResult[] = [];
    let phasesVisited = 0;

    const ctx: SopContext = {
      phaseHistory: completedPhases,
      lastOutput: undefined,
      data: initialData ?? {},
    };

    for (const phase of phases) {
      // Infinite-cycle safety guard
      phasesVisited++;
      if (phasesVisited > MAX_PHASES_VISITED) {
        throw new SopMaxTransitionsExceededError(phasesVisited, MAX_PHASES_VISITED);
      }

      // Abort check between phases
      if (this.options.signal?.aborted) {
        return this.buildResult(completedPhases, 'aborted', false);
      }

      // Execute phase with retry
      const phaseStart = Date.now();
      const result = await this.executePhaseWithRetry(parentContext, phase, ctx);
      const durationMs = Date.now() - phaseStart;

      const phaseResult: SopPhaseResult = {
        phaseName: phase.name,
        result,
        durationMs,
      };

      // Phase hard-failed even after retries
      if (result.status !== 'success') {
        if (this.options.signal?.aborted || result.error === 'Execution was aborted') {
          return this.buildResult(completedPhases, 'aborted', false);
        }
        completedPhases.push(phaseResult);
        throw new SopPhaseExecutionError(phase.name, phase.agentName, result.error ?? 'Unknown error');
      }

      completedPhases.push(phaseResult);

      // Evaluate guard function
      if (phase.guard && !phase.guard(result)) {
        // Guard failed — halt workflow and flag for human review
        ctx.lastOutput = result.response;
        ctx.phaseHistory = [...completedPhases];
        return this.buildResult(completedPhases, 'guard_failed', true);
      }

      // Thread output to next phase context
      ctx.lastOutput = result.response;
      ctx.phaseHistory = [...completedPhases];

      // Optional checkpoint after each phase
      await this.savePhaseCheckpoint(parentContext, completedPhases);
    }

    return this.buildResult(completedPhases, 'completed', false);
  }

  // ---------------------------------------------------------------------------
  // Phase execution with retry and timeout
  // ---------------------------------------------------------------------------

  private async executePhaseWithRetry(
    parentContext: AgentContext,
    phase: SopPhase,
    ctx: SopContext,
  ): Promise<SubAgentResult> {
    const message = phase.buildMessage(ctx);
    const task: SubAgentTask = {
      agentName: phase.agentName,
      message,
      narrowing: phase.narrowing,
      signal: this.options.signal,
    };

    const maxAttempts = this.options.retriesPerPhase + 1;
    let lastResult: SubAgentResult | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.options.signal?.aborted) {
        return {
          agentName: phase.agentName,
          status: 'failed',
          response: '',
          toolCount: 0,
          error: 'Execution was aborted',
        };
      }

      lastResult = await this.executeWithTimeout(parentContext, task);
      if (lastResult.status === 'success') {
        return lastResult;
      }
    }

    return lastResult ?? {
      agentName: phase.agentName,
      status: 'failed',
      response: '',
      toolCount: 0,
      error: `Phase "${phase.name}" failed after ${maxAttempts} attempt(s)`,
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
        resolve({ agentName: task.agentName, status: 'failed', response: '', toolCount: 0, error: 'Execution was aborted' });
        return;
      }
      if (activeSignal) {
        abortHandler = () =>
          resolve({ agentName: task.agentName, status: 'failed', response: '', toolCount: 0, error: 'Execution was aborted' });
        activeSignal.addEventListener('abort', abortHandler, { once: true });
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
    const finalOutput = phases.length > 0
      ? (phases[phases.length - 1].result.response)
      : '';
    return { phases, finalOutput, requiresHumanReview, terminationReason };
  }

  private async savePhaseCheckpoint(
    parentContext: AgentContext,
    completedPhases: SopPhaseResult[],
  ): Promise<void> {
    if (!this.options.stateStore) return;
    const tenantId = parentContext.security.tenantId ?? 'default';
    const key = `agentic:${tenantId}:sop:${parentContext.sessionId}:checkpoint`;
    await this.options.stateStore.set(
      key,
      { completedPhaseNames: completedPhases.map((p) => p.phaseName) },
      this.options.checkpointTtlSeconds,
    );
  }
}
