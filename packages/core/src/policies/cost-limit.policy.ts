import type { AgentContext, PolicyResult, ToolPolicy } from '../interfaces';

/**
 * Options for configuring financial/numeric cost limit policy.
 */
export interface CostLimitOptions {
  /** Name of the numeric argument to evaluate. Default: `'amount'` */
  paramName?: string;

  /** Maximum amount allowed automatically without approval. Default: `1000` */
  autoAllowLimit?: number;

  /** Maximum amount requiring human approval before rejection. Default: `10000` */
  approvalLimit?: number;
}

/**
 * Built-in policy evaluating numeric risk/cost arguments across a 3-state boundary (`allow` -> `require_approval` -> `deny`).
 *
 * @example
 * ```typescript
 * @UsePolicies(new CostLimitPolicy({ paramName: 'amount', autoAllowLimit: 500, approvalLimit: 10000 }))
 * ```
 */
export class CostLimitPolicy implements ToolPolicy {
  private readonly paramName: string;
  private readonly autoAllowLimit: number;
  private readonly approvalLimit: number;

  /**
   * Creates a new instance of CostLimitPolicy.
   * @param options Configuration options.
   */
  constructor(options?: CostLimitOptions) {
    this.paramName = options?.paramName ?? 'amount';
    this.autoAllowLimit = options?.autoAllowLimit ?? 1000;
    this.approvalLimit = options?.approvalLimit ?? 10000;
  }

  /**
   * Evaluates the numeric argument against auto-allow and human approval boundaries.
   */
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
