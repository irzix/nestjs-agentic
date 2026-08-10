import type { AgentContext, PolicyResult, ToolPolicy } from '../interfaces';

/**
 * Options for configuring sliding-window rate limit policy.
 */
export interface RateLimitOptions {
  /** Maximum allowed tool executions per sliding-window minute. Default: `10` */
  maxCallsPerMinute?: number;
}

/**
 * Built-in sliding-window rate limit policy enforcing call frequency bounds per tenant, user, and tool.
 *
 * @example
 * ```typescript
 * @UsePolicies(new RateLimitPolicy({ maxCallsPerMinute: 5 }))
 * ```
 */
export class RateLimitPolicy implements ToolPolicy {
  private static readonly history = new Map<string, number[]>();
  private readonly maxCalls: number;

  /**
   * Creates a new instance of RateLimitPolicy.
   * @param options Configuration options.
   */
  constructor(options?: RateLimitOptions) {
    this.maxCalls = options?.maxCallsPerMinute ?? 10;
  }

  /**
   * Evaluates the rate limit state for the given context and tool name.
   */
  async evaluate(
    ctx: AgentContext,
    toolName: string,
    _args?: Record<string, unknown>,
  ): Promise<PolicyResult> {
    const key = `${ctx.security.tenantId || 'global'}:${ctx.security.userId || 'anon'}:${toolName}`;
    const now = Date.now();
    const windowMs = 60 * 1000;

    const timestamps = (RateLimitPolicy.history.get(key) ?? []).filter(
      (ts) => now - ts < windowMs,
    );

    if (timestamps.length >= this.maxCalls) {
      return {
        decision: 'deny',
        reason: `Rate limit exceeded for tool "${toolName}". Max allowed: ${this.maxCalls} calls per minute.`,
      };
    }

    timestamps.push(now);
    RateLimitPolicy.history.set(key, timestamps);

    return { decision: 'allow' };
  }
}
