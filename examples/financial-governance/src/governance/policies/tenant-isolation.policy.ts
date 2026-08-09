import { Injectable } from '@nestjs/common';
import type { AgentContext, PolicyResult, ToolPolicy } from 'nestjs-agentic';

@Injectable()
export class TenantIsolationPolicy implements ToolPolicy {
  async evaluate(ctx: AgentContext): Promise<PolicyResult> {
    if (!ctx.security.tenantId) {
      return {
        decision: 'deny',
        reason: 'Tenant isolation violation: Missing tenantId in security context.',
      };
    }

    if (ctx.security.tenantId === 'suspended_tenant') {
      return {
        decision: 'deny',
        reason: 'Tenant isolation violation: Tenant account is currently suspended.',
      };
    }

    return { decision: 'allow' };
  }
}
