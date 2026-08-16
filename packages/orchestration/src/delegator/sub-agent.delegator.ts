import type { AgentContext, AgentRunner } from '@nestjs-agentic/core';
import { CapabilityEscalationError, MaxDelegationDepthExceededError } from '../errors';
import type {
  AgenticInternalContext,
  CapabilityNarrowing,
  SubAgentResult,
  SubAgentTask,
} from '../interfaces/orchestration.interface';

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
    const parentAgentic = (parentContext.data?.agentic as AgenticInternalContext | undefined) ?? {};
    const parentDepth =
      parentAgentic.delegationDepth ??
      (parentContext.data?.__delegationDepth as number | undefined) ??
      0;
    const currentDepth = parentDepth + 1;
    if (currentDepth > this.maxDelegationDepth) {
      throw new MaxDelegationDepthExceededError(
        currentDepth,
        this.maxDelegationDepth,
        task.agentName,
      );
    }

    // 2. Capability narrowing validation: Permissions & Roles (Strict Escalation Prevention)
    const parentPerms = parentContext.security.permissions ?? [];
    if (task.narrowing?.allowedPermissions) {
      const invalidPerms = task.narrowing.allowedPermissions.filter((p) => !parentPerms.includes(p));
      if (invalidPerms.length > 0) {
        throw new CapabilityEscalationError(invalidPerms, parentPerms, 'permissions');
      }
    }
    const permissions = task.narrowing?.allowedPermissions
      ? parentPerms.filter((p) => task.narrowing!.allowedPermissions!.includes(p))
      : parentContext.security.permissions;

    const parentRoles = parentContext.security.roles ?? [];
    if (task.narrowing?.allowedRoles) {
      const invalidRoles = task.narrowing.allowedRoles.filter((r) => !parentRoles.includes(r));
      if (invalidRoles.length > 0) {
        throw new CapabilityEscalationError(invalidRoles, parentRoles, 'roles');
      }
    }
    const roles = task.narrowing?.allowedRoles
      ? parentRoles.filter((r) => task.narrowing!.allowedRoles!.includes(r))
      : parentContext.security.roles;

    // 3. Stacking & Inheritance of Tool Whitelists and Blacklists across delegation layers
    const parentNarrowing =
      parentAgentic.capabilityNarrowing ??
      (parentContext.data?.__capabilityNarrowing as CapabilityNarrowing | undefined);

    let effectiveAllowedTools: string[] | undefined = task.narrowing?.allowedTools;
    if (parentNarrowing?.allowedTools) {
      effectiveAllowedTools = effectiveAllowedTools
        ? effectiveAllowedTools.filter((t) => parentNarrowing.allowedTools!.includes(t))
        : parentNarrowing.allowedTools;
    }

    const effectiveDeniedTools: string[] = [
      ...(parentNarrowing?.deniedTools ?? []),
      ...(task.narrowing?.deniedTools ?? []),
    ];

    const effectiveNarrowing: CapabilityNarrowing | undefined =
      task.narrowing || parentNarrowing
        ? {
            ...parentNarrowing,
            ...task.narrowing,
            allowedTools: effectiveAllowedTools,
            deniedTools: effectiveDeniedTools.length > 0 ? Array.from(new Set(effectiveDeniedTools)) : undefined,
          }
        : undefined;

    // 4. Versioned Session Memory Namespacing
    const iterSuffix = iteration !== undefined ? `:iter_${iteration}` : '';
    const subSessionId = `${parentContext.sessionId}:${task.agentName}${iterSuffix}`;

    // 5. Clean Structured Namespaced Metadata
    const childData: Record<string, unknown> = {
      ...(parentContext.data || {}),
      ...(task.data || {}),
      agentic: {
        ...parentAgentic,
        capabilityNarrowing: effectiveNarrowing,
        delegationDepth: currentDepth,
      },
    };

    const startTime = Date.now();
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
        tokens: runResult.usage
          ? {
              inputTokens: runResult.usage.inputTokens ?? 0,
              outputTokens: runResult.usage.outputTokens ?? 0,
              totalTokens: runResult.usage.totalTokens ?? 0,
            }
          : undefined,
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        agentName: task.agentName,
        status: 'failed',
        response: '',
        toolCount: 0,
        error: message || 'Sub-agent execution error',
        durationMs: Date.now() - startTime,
      };
    }
  }
}
