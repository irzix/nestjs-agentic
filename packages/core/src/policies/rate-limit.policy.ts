import type { AgentContext, PolicyResult, ToolPolicy } from '../interfaces';

export interface RateLimitOptions {
  maxCallsPerMinute?: number;
}

/**
 * Built-in policy enforcing tool call rate limits per tenant/user.
 */
export class RateLimitPolicy implements ToolPolicy {
  private static readonly history = new Map<string, number[]>();
  private readonly maxCalls: number;

  constructor(options?: RateLimitOptions) {
    this.maxCalls = options?.maxCallsPerMinute ?? 10;
  }

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
