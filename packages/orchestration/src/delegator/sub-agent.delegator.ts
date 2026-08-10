import type { AgentRunner } from '@nestjs-agentic/core';
import type { SubAgentTask, SubAgentResult } from '../interfaces/orchestration.interface';

/**
 * Parent security context inherited by sub-agents to enforce multi-tenant isolation.
 */
export interface ParentSecurityContext {
  /** User identifier of the requesting user. */
  userId?: string;

  /** Tenant identifier for multi-tenant data isolation. */
  tenantId?: string;

  /** User roles for policy authorization evaluations. */
  roles?: string[];

  /** Permission scopes granted to the user. */
  permissions?: string[];

  /** Custom metadata key-value bag passed down into tool closures. */
  data?: Record<string, unknown>;
}

/**
 * Delegator service for delegating sub-tasks to designated sub-agents while maintaining parent context isolation.
 */
export class SubAgentDelegator {
  /**
   * Creates a new instance of SubAgentDelegator.
   * @param runner The core AgentRunner instance used to execute sub-agents.
   */
  constructor(private readonly runner: AgentRunner) {}

  /**
   * Delegates a single task to a designated sub-agent, preserving parent security context and namespacing session memory.
   *
   * @param parentSessionId The parent session identifier.
   * @param parentSecurityContext Security context inherited from the parent agent.
   * @param task Sub-agent task payload.
   * @param iteration Optional loop iteration index for versioned session memory namespacing.
   * @returns Promise resolving to the sub-agent execution result.
   */
  async delegate(
    parentSessionId: string,
    parentSecurityContext: ParentSecurityContext,
    task: SubAgentTask,
    iteration?: number,
  ): Promise<SubAgentResult> {
    const iterSuffix = iteration !== undefined ? `:iter_${iteration}` : '';
    const subSessionId = `${parentSessionId}:${task.agentName}${iterSuffix}`;

    try {
      const runResult = await this.runner.run(task.agentName, {
        sessionId: subSessionId,
        message: task.message,
        context: {
          ...parentSecurityContext,
          ...(task.context || {}),
        },
      });

      return {
        agentName: task.agentName,
        status: 'success',
        response: runResult.output || '',
        toolCount: runResult.toolCalls?.length || 0,
      };
    } catch (err: any) {
      return {
        agentName: task.agentName,
        status: 'failed',
        response: '',
        toolCount: 0,
        error: err?.message || 'Sub-agent execution error',
      };
    }
  }
}
