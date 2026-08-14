import type { AgentContext, PolicyResult, ToolPolicy } from '../interfaces';
import type { IdempotencyStore } from '../interfaces/idempotency.interface';

export interface IdempotencyPolicyOptions {
  /**
   * Custom key generator. If omitted, checks `args.idempotencyKey` or `ctx.data.idempotencyKey`.
   */
  keyGenerator?: (ctx: AgentContext, toolName: string, args: Record<string, unknown>) => string | undefined;

  /**
   * Whether to require an idempotency key. If true and no key is found, denies execution. Default: true.
   */
  required?: boolean;

  /**
   * Custom IdempotencyStore instance to check for prior executions.
   */
  store?: IdempotencyStore;
}

/**
 * Built-in policy for validating and enforcing idempotency keys on side-effecting tools.
 */
export class IdempotencyPolicy implements ToolPolicy {
  private readonly required: boolean;

  constructor(private readonly options?: IdempotencyPolicyOptions) {
    this.required = options?.required ?? true;
  }

  async evaluate(
    ctx: AgentContext,
    toolName: string,
    args?: Record<string, unknown>,
  ): Promise<PolicyResult> {
    const safeArgs = args || {};
    const key = this.options?.keyGenerator
      ? this.options.keyGenerator(ctx, toolName, safeArgs)
      : (safeArgs.idempotencyKey as string) || (ctx.data?.idempotencyKey as string);

    if (this.required && !key) {
      return {
        decision: 'deny',
        reason: `Idempotency key required for tool "${toolName}" but was not provided.`,
      };
    }

    return { decision: 'allow' };
  }
}
