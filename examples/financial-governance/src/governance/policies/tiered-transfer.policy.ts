import { Injectable } from '@nestjs/common';
import type { AgentContext, PolicyResult, ToolPolicy } from 'nestjs-agentic';

@Injectable()
export class TieredTransferPolicy implements ToolPolicy {
  async evaluate(
    ctx: AgentContext,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    const amount = Number(args.amount || 0);

    // 1. Hard cap: Any transfer over $100,000 is automatically denied
    if (amount > 100000) {
      return {
        decision: 'deny',
        reason: 'Transfer amount exceeds maximum system limit ($100,000).',
      };
    }

    // 2. Role check: Non-finance officers are denied for high amounts
    if (amount > 5000 && !ctx.security.roles?.includes('finance_officer')) {
      return {
        decision: 'deny',
        reason: 'Role authorization failure: Transfers over $5,000 require "finance_officer" role.',
      };
    }

    // 3. Human Approval Threshold: Transfers over $10,000 require Senior Executive approval
    if (amount > 10000) {
      return {
        decision: 'require_approval',
        reason: `Transfer of $${amount} exceeds auto-approval threshold ($10,000). Requires Senior Executive HITL approval.`,
      };
    }

    return { decision: 'allow' };
  }
}
