import type { AgentContext, PolicyResult, ToolPolicy } from '../interfaces';
import { scopeKey } from '../utils/scope-key';

/**
 * Options for configuring sliding-window rate limit policy.
 */
export interface RateLimitOptions {
  /** Maximum allowed tool executions per sliding-window minute. Default: `10` */
  maxCallsPerMinute?: number;

  /**
   * How often (in ms) to opportunistically sweep and evict entries whose
   * window has fully expired, bounding the shared history map's memory
   * growth. Without this, every distinct (tenant, user, tool) combination
   * ever seen keeps a permanent entry, even once it's never called again.
   * The sweep runs lazily on the next `evaluate()` call after this interval
   * elapses — not on a timer — so it never keeps the process alive and
   * needs no explicit shutdown. Set to `0` to sweep on every call (useful
   * in tests). Default: `300_000` (5 minutes)
   */
  sweepIntervalMs?: number;
}

/**
 * Built-in sliding-window rate limit policy enforcing call frequency bounds per tenant, user, and tool.
 *
 * Backed by process-local state (a `static` map shared by every instance in
 * the process), not a distributed store — two pods each enforce the
 * configured limit independently, and a restart resets all counters. Use a
 * `StateStore`/Redis-backed rate limiter instead when the limit must hold
 * across multiple instances.
 *
 * @example
 * ```typescript
 * @UsePolicies(new RateLimitPolicy({ maxCallsPerMinute: 5 }))
 * ```
 */
export class RateLimitPolicy implements ToolPolicy {
  private static readonly history = new Map<string, number[]>();
  private static lastSweepAt = 0;

  private readonly maxCalls: number;
  private readonly windowMs = 60 * 1000;
  private readonly sweepIntervalMs: number;

  /**
   * Creates a new instance of RateLimitPolicy.
   * @param options Configuration options.
   */
  constructor(options?: RateLimitOptions) {
    this.maxCalls = options?.maxCallsPerMinute ?? 10;
    this.sweepIntervalMs = options?.sweepIntervalMs ?? 5 * 60 * 1000;
  }

  /**
   * Evaluates the rate limit state for the given context and tool name.
   */
  async evaluate(
    ctx: AgentContext,
    toolName: string,
    _args?: Record<string, unknown>,
  ): Promise<PolicyResult> {
    const key = scopeKey(ctx.security.tenantId, ctx.security.userId, toolName);
    const now = Date.now();

    this.sweepExpiredEntries(now);

    const timestamps = (RateLimitPolicy.history.get(key) ?? []).filter(
      (ts) => now - ts < this.windowMs,
    );

    if (timestamps.length >= this.maxCalls) {
      // Keep the pruned (but still-full) window even on denial, so a
      // caller retrying immediately doesn't re-grow a stale array.
      RateLimitPolicy.history.set(key, timestamps);

      // A slot frees up once the oldest call in the window ages out. Never
      // below 1s, so the hint can't invite an immediate guaranteed-denied retry.
      const oldest = timestamps[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));

      return {
        decision: 'deny',
        reason:
          `Rate limit exceeded for tool "${toolName}". Max allowed: ${this.maxCalls} calls ` +
          `per minute. Retry after ${retryAfterSeconds}s.`,
        retryAfterSeconds,
      };
    }

    timestamps.push(now);
    RateLimitPolicy.history.set(key, timestamps);

    return { decision: 'allow' };
  }

  /**
   * Opportunistically evicts every history entry whose window has fully
   * expired, bounding the map's size to the set of (tenant, user, tool)
   * combinations active within the last window rather than every
   * combination ever seen. Runs at most once per `sweepIntervalMs`, so the
   * O(map size) cost is amortized rather than paid on every call.
   */
  private sweepExpiredEntries(now: number): void {
    if (now - RateLimitPolicy.lastSweepAt < this.sweepIntervalMs) return;
    RateLimitPolicy.lastSweepAt = now;

    for (const [key, timestamps] of RateLimitPolicy.history) {
      const fresh = timestamps.filter((ts) => now - ts < this.windowMs);
      if (fresh.length === 0) {
        RateLimitPolicy.history.delete(key);
      } else if (fresh.length !== timestamps.length) {
        RateLimitPolicy.history.set(key, fresh);
      }
    }
  }
}
