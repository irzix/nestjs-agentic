import { randomUUID } from 'crypto';

import type { AgentContext, PolicyResult, ToolPolicy } from '../interfaces';
import type { GenericRedisClient } from '../stores/redis/redis-state.store';
import { scopeKey } from '../utils/scope-key';

/** Runs a Lua script server-side. */
export type RateLimitEvalFn = (
  script: string,
  keys: string[],
  args: (string | number)[],
) => Promise<unknown>;

/** Options for configuring DistributedRateLimitPolicy. */
export interface DistributedRateLimitOptions {
  /**
   * Redis client exposing `eval` in the positional ioredis form. Omit when
   * supplying `evalFn` instead.
   */
  client?: GenericRedisClient;

  /**
   * Adapter for clients whose `eval` signature differs, such as node-redis v4:
   *
   * ```typescript
   * evalFn: (script, keys, args) =>
   *   client.eval(script, { keys, arguments: args.map(String) })
   * ```
   *
   * Takes precedence over `client`.
   */
  evalFn?: RateLimitEvalFn;

  /** Maximum allowed tool executions per window. Default: `10` */
  maxCallsPerWindow?: number;

  /** Sliding window length in milliseconds. Default: `60_000` (one minute) */
  windowMs?: number;

  /** Redis key prefix. Default: `'agentic:ratelimit:'` */
  keyPrefix?: string;
}

/**
 * Evict, count, and admit in one `EVAL`, so concurrent callers on different pods
 * cannot both pass a check only one should. Time comes from Redis `TIME` rather
 * than the caller, so clock skew cannot widen the window.
 *
 * `ARGV`: window (ms), max calls, member id. Returns `{ allowed, retryAfterMs }`.
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local maxCalls = tonumber(ARGV[2])
local member = ARGV[3]

local clock = redis.call('TIME')
local now = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)

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
 * combined limit and survives a restart. Each window is a sorted set with a
 * `PEXPIRE` matching it, so idle callers' keys expire on their own. A denial
 * reports `retryAfterSeconds`.
 *
 * @example
 * ```typescript
 * @UsePolicies(new DistributedRateLimitPolicy({ client: redis, maxCallsPerWindow: 5 }))
 * ```
 */
export class DistributedRateLimitPolicy implements ToolPolicy {
  private readonly evalFn: RateLimitEvalFn;
  private readonly maxCalls: number;
  private readonly windowMs: number;
  private readonly keyPrefix: string;

  /**
   * @param options Redis client (or `evalFn` adapter) plus window/limit configuration.
   * @throws {TypeError} If no way to run `EVAL` is supplied, or the limit/window is invalid.
   */
  constructor(options: DistributedRateLimitOptions) {
    const clientEval = options.client?.eval;
    const evalFn =
      options.evalFn ??
      (typeof clientEval === 'function'
        ? (script: string, keys: string[], args: (string | number)[]) =>
            clientEval.call(options.client, script, keys.length, ...keys, ...args)
        : undefined);

    if (!evalFn) {
      throw new TypeError(
        'DistributedRateLimitPolicy requires a Redis client exposing eval(), or an evalFn ' +
          'adapter. Without a server-side script the check-then-admit step is not atomic, so ' +
          'the limit would leak across concurrent callers — use RateLimitPolicy if a ' +
          'per-process limit is enough. For node-redis v4, pass evalFn: (script, keys, args) => ' +
          'client.eval(script, { keys, arguments: args.map(String) }).',
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

    this.evalFn = evalFn;
    this.keyPrefix = options.keyPrefix ?? 'agentic:ratelimit:';
  }

  /**
   * @param ctx Supplies the tenant and user the window is keyed by.
   * @param toolName Also part of the key.
   * @returns `allow`, or `deny` carrying `retryAfterSeconds`.
   */
  async evaluate(
    ctx: AgentContext,
    toolName: string,
    _args?: Record<string, unknown>,
  ): Promise<PolicyResult> {
    const key = `${this.keyPrefix}${scopeKey(ctx.security.tenantId, ctx.security.userId, toolName)}`;

    // A sorted set treats an identical member as an update, so a per-call UUID is
    // what keeps two calls from collapsing into one slot. Anything derived from
    // pid/timestamp/counter collides across pods, which silently undercounts.
    const raw = await this.evalFn(SLIDING_WINDOW_SCRIPT, [key], [
      this.windowMs,
      this.maxCalls,
      randomUUID(),
    ]);

    const [allowed, retryAfterMs] = normalizeScriptResult(raw);

    if (allowed) {
      return { decision: 'allow' };
    }

    // Never below 1: "retry after 0 seconds" invites a guaranteed-denied retry.
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

/** Reads the `{ allowed, retryAfterMs }` pair back, tolerating string-typed Lua numbers. */
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
