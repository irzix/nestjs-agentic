import type { AgentContext, AgentRunner } from '@nestjs-agentic/core';
import { MaxDelegationDepthExceededError } from '../errors';
import type { SubAgentResult, SubAgentTask } from '../interfaces/orchestration.interface';

export interface SubAgentDelegatorOptions {
  /** Maximum allowed delegation recursion depth. Default: `3` */
  maxDelegationDepth?: number;
}

/**
 * Service for delegating tasks to designated sub-agents while maintaining strict multi-tenant isolation,
 * distributed trace propagation, and capability narrowing.
 */
export class SubAgentDelegator {
  private readonly maxDelegationDepth: number;

  constructor(
    private readonly runner: AgentRunner,
    options?: SubAgentDelegatorOptions,
  ) {
    this.maxDelegationDepth = options?.maxDelegationDepth ?? 3;
  }

  /**
   * Delegates a task to a designated sub-agent with immutable tenant isolation and capability narrowing.
   */
  async delegate(
    parentContext: AgentContext,
    task: SubAgentTask,
    iteration?: number,
    signal?: AbortSignal,
  ): Promise<SubAgentResult> {
    const activeSignal = task.signal ?? signal ?? parentContext.signal;
    if (activeSignal?.aborted) {
      return {
        agentName: task.agentName,
        status: 'failed',
        response: '',
        toolCount: 0,
        error: 'Sub-agent run was aborted',
      };
    }

    // 1. Guard against infinite delegation recursion depth
    const parentDepth = (parentContext.data?.__delegationDepth as number | undefined) ?? 0;
    const currentDepth = parentDepth + 1;
    if (currentDepth > this.maxDelegationDepth) {
      throw new MaxDelegationDepthExceededError(
        currentDepth,
        this.maxDelegationDepth,
        task.agentName,
      );
    }

    // 2. Capability narrowing: Permissions & Roles (Principle of Least Privilege)
    const permissions = task.narrowing?.allowedPermissions
      ? (parentContext.security.permissions ?? []).filter((p) =>
          task.narrowing!.allowedPermissions!.includes(p),
        )
      : parentContext.security.permissions;

    const roles = task.narrowing?.allowedRoles
      ? (parentContext.security.roles ?? []).filter((r) =>
          task.narrowing!.allowedRoles!.includes(r),
        )
      : parentContext.security.roles;

    // 3. Versioned Session Memory Namespacing
    const iterSuffix = iteration !== undefined ? `:iter_${iteration}` : '';
    const subSessionId = `${parentContext.sessionId}:${task.agentName}${iterSuffix}`;

    // 4. Metadata & Tool Whitelisting/Blacklisting
    const childData: Record<string, unknown> = {
      ...(parentContext.data || {}),
      ...(task.data || {}),
      __delegationDepth: currentDepth,
      __capabilityNarrowing: task.narrowing,
    };

    try {
      const runResult = await this.runner.run(task.agentName, {
        sessionId: subSessionId,
        message: task.message,
        limits: task.narrowing?.limits,
        signal: activeSignal,
        context: {
          userId: parentContext.security.userId,
          tenantId: parentContext.security.tenantId, // Strictly immutable
          roles,
          permissions,
          data: childData,
          parentTraceId: parentContext.traceId,
          rootTraceId: parentContext.rootTraceId ?? parentContext.traceId,
        },
      });

      return {
        agentName: task.agentName,
        status: 'success',
        response: runResult.output || '',
        toolCount: runResult.toolCalls?.length || 0,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        agentName: task.agentName,
        status: 'failed',
        response: '',
        toolCount: 0,
        error: message || 'Sub-agent execution error',
      };
    }
  }
}
