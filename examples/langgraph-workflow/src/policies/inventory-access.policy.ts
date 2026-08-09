import { Injectable } from '@nestjs/common';
import type { AgentContext, PolicyResult, ToolPolicy } from '@nestjs-agentic/core';

@Injectable()
export class InventoryAccessPolicy implements ToolPolicy {
  async evaluate(context: AgentContext): Promise<PolicyResult> {
    if (context.security.tenantId === 'suspended_tenant') {
      return {
        decision: 'deny',
        reason: 'Tenant account is currently suspended due to billing policy.',
      };
    }

    return { decision: 'allow' };
  }
}
