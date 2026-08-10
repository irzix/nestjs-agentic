import type { AgentRunner } from '@nestjs-agentic/core';
import type { SubAgentTask, SubAgentResult } from '../interfaces/orchestration.interface';

export interface ParentSecurityContext {
  userId?: string;
  tenantId?: string;
  roles?: string[];
  permissions?: string[];
  data?: Record<string, unknown>;
}

export class SubAgentDelegator {
  constructor(private readonly runner: AgentRunner) {}

  /**
   * Delegates a single task to a designated sub-agent, preserving parent tenant isolation and context.
   */
  async delegate(
    parentSessionId: string,
    parentSecurityContext: ParentSecurityContext,
    task: SubAgentTask,
  ): Promise<SubAgentResult> {
    const subSessionId = `${parentSessionId}:${task.agentName}`;

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
