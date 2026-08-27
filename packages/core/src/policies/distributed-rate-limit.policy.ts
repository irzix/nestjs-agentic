import type { AgentContext, PolicyResult, ToolPolicy } from '../interfaces';
import type { GenericRedisClient } from '../stores/redis/redis-state.store';
import { scopeKey } from '../utils/scope-key';

/** Options for configuring DistributedRateLimitPolicy. */
export interface DistributedRateLimitOptions {
  /** Redis client. Must expose `eval`, since the limiter needs a server-side script. */
  client: GenericRedisClient;

  /** Maximum allowed tool executions per window. Default: `10` */
  maxCallsPerWindow?: number;

  /** Sliding window length in milliseconds. Default: `60_000` (one minute) */
  windowMs?: number;

  /** Redis key prefix. Default: `'agentic:ratelimit:'` */
  keyPrefix?: string;
}

/**
 * Evicts timestamps outside the window, counts what remains, and admits the call
 * only if there is room — all in one `EVAL`, so concurrent callers on different
 * pods cannot both pass a check that only one of them should.
 *
 * `ARGV`: now (ms), window (ms), max calls, member id.
 * Returns `{ allowed, retryAfterMs }`.
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxCalls = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)
local used = redis.call('ZCARD', key)

if used >= maxCalls then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfterMs = windowMs
  if oldest[2] then
    retryAfterMs = (tonumber(oldest[2]) + windowMs) - now
    if retryAfterMs < 0 then retryAfterMs = 0 end
  end
  return { 0, retryAfterMs }
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)
return { 1, 0 }
`;

/**
 * Sliding-window rate limit policy enforced across every instance sharing one
 * Redis, keyed per tenant, user, and tool.
 *
 * Unlike `RateLimitPolicy`, which keeps its window in a process-local map and so
 * lets N pods each admit the configured limit independently, this holds a single
 * combined limit and survives a restart. Each window is a Redis sorted set with a
 * `PEXPIRE` matching the window, so keys for idle callers expire on their own
 * rather than accumulating.
 *
 * A denial reports how long to wait, both in the reason text the model sees and as
 * `retryAfterSeconds` on the result.
 *
 * @example
 * ```typescript
 * @UsePolicies(new DistributedRateLimitPolicy({ client: redis, maxCallsPerWindow: 5 }))
 * ```
 */
export class DistributedRateLimitPolicy implements ToolPolicy {
  private readonly client: GenericRedisClient;
  private readonly maxCalls: number;
  private readonly windowMs: number;
  private readonly keyPrefix: string;
  private callCounter = 0;

  /**
   * @param options Redis client plus window/limit configuration.
   * @throws {TypeError} If the client cannot run `EVAL`, or the limit/window is invalid.
   */
  constructor(options: DistributedRateLimitOptions) {
    if (typeof options.client?.eval !== 'function') {
      throw new TypeError(
        'DistributedRateLimitPolicy requires a Redis client exposing eval(). Without a ' +
          'server-side script the check-then-admit step is not atomic, so the limit would ' +
          'leak across concurrent callers — use RateLimitPolicy if a per-process limit is enough.',
      );
    }

    this.maxCalls = options.maxCallsPerWindow ?? 10;
    this.windowMs = options.windowMs ?? 60_000;

    if (!Number.isInteger(this.maxCalls) || this.maxCalls < 1) {
      throw new TypeError(
        `DistributedRateLimitPolicy: maxCallsPerWindow must be a positive integer, received ${String(this.maxCalls)}.`,
      );
    }
    if (!Number.isInteger(this.windowMs) || this.windowMs < 1) {
      throw new TypeError(
        `DistributedRateLimitPolicy: windowMs must be a positive integer, received ${String(this.windowMs)}.`,
      );
    }

    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'agentic:ratelimit:';
  }

  /**
   * Admits or denies the call against the shared window.
   *
   * @param ctx Execution context, supplying the tenant and user the window is keyed by.
   * @param toolName Tool being invoked, also part of the key.
   * @returns `allow`, or `deny` carrying `retryAfterSeconds`.
   */
  async evaluate(
    ctx: AgentContext,
    toolName: string,
    _args?: Record<string, unknown>,
  ): Promise<PolicyResult> {
    const key = `${this.keyPrefix}${scopeKey(ctx.security.tenantId, ctx.security.userId, toolName)}`;
    const now = Date.now();
    // Distinct per call so two calls landing on the same millisecond both occupy a
    // slot: a sorted set would otherwise treat them as one member and undercount.
    const member = `${now}-${process.pid}-${this.callCounter++}`;

    const raw = await this.client.eval!(
      SLIDING_WINDOW_SCRIPT,
      1,
      key,
      now,
      this.windowMs,
      this.maxCalls,
      member,
    );

    const [allowed, retryAfterMs] = normalizeScriptResult(raw);

    if (allowed) {
      return { decision: 'allow' };
    }

    // Rounded up, and never below 1: reporting "retry after 0 seconds" would
    // invite an immediate retry that is guaranteed to be denied again.
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

    return {
      decision: 'deny',
      reason:
        `Rate limit exceeded for tool "${toolName}". Max allowed: ${this.maxCalls} calls ` +
        `per ${Math.round(this.windowMs / 1000)}s. Retry after ${retryAfterSeconds}s.`,
      retryAfterSeconds,
    };
  }
}

/**
 * Reads the `{ allowed, retryAfterMs }` pair back from a driver.
 *
 * Clients disagree on how Lua numbers surface — ioredis yields numbers, some
 * wrappers yield strings — so both are accepted rather than trusting one shape.
 */
function normalizeScriptResult(raw: unknown): [boolean, number] {
  if (!Array.isArray(raw)) {
    throw new TypeError(
      `DistributedRateLimitPolicy: expected the rate-limit script to return an array, received ${typeof raw}.`,
    );
  }

  const allowed = Number(raw[0]) === 1;
  const retryAfterMs = Number(raw[1]);

  return [allowed, Number.isFinite(retryAfterMs) ? retryAfterMs : 0];
}
