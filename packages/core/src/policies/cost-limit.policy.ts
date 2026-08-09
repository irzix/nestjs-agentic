import type { AgentContext, PolicyResult, ToolPolicy } from '../interfaces';

export interface CostLimitOptions {
  paramName?: string;
  autoAllowLimit?: number;
  approvalLimit?: number;
}

/**
 * Built-in policy evaluating numeric risk/cost arguments.
 */
export class CostLimitPolicy implements ToolPolicy {
  private readonly paramName: string;
  private readonly autoAllowLimit: number;
  private readonly approvalLimit: number;

  constructor(options?: CostLimitOptions) {
    this.paramName = options?.paramName ?? 'amount';
    this.autoAllowLimit = options?.autoAllowLimit ?? 1000;
    this.approvalLimit = options?.approvalLimit ?? 10000;
  }

  async evaluate(
    _ctx: AgentContext,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    const rawVal = args[this.paramName];
    const amount = typeof rawVal === 'number' ? rawVal : Number(rawVal) || 0;

    if (amount <= this.autoAllowLimit) {
      return { decision: 'allow' };
    }

    if (amount <= this.approvalLimit) {
      return {
        decision: 'require_approval',
        reason: `Transaction amount $${amount} on tool "${toolName}" exceeds auto-allow limit ($${this.autoAllowLimit}) and requires human approval.`,
      };
    }

    return {
      decision: 'deny',
      reason: `Transaction amount $${amount} on tool "${toolName}" exceeds maximum safety limit ($${this.approvalLimit}).`,
    };
  }
}
