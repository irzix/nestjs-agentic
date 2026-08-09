import { Injectable } from '@nestjs/common';
import type { AgentContext, PolicyResult, ToolPolicy } from 'nestjs-agentic';

@Injectable()
export class RefundLimitPolicy implements ToolPolicy {
  async evaluate(
    ctx: AgentContext,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    const amount = Number(args.amount);
    if (amount > 500) {
      return {
        decision: 'require_approval',
        reason: `Refund of $${amount} exceeds auto-approval limit ($500).`,
      };
    }
    return { decision: 'allow' };
  }
}
