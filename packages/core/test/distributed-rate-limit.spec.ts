import {
  DistributedRateLimitPolicy,
  RateLimitPolicy,
  runRateLimiterContract,
} from '../src';
import type { AgentContext, GenericRedisClient } from '../src';

/**
 * In-process Redis stand-in that really runs the limiter's sorted-set logic.
 *
 * The policy's atomicity comes from Redis executing its script without
 * interleaving, which single-threaded JS reproduces faithfully: the whole `eval`
 * body runs to completion before any other call observes the data. So this
 * exercises the actual algorithm rather than a stub that always says yes.
 */
function createFakeRedis() {
  /** key -> sorted set, as member/score pairs. */
  const sets = new Map<string, { member: string; score: number }[]>();
  const expiries = new Map<string, number>();
  let evalCalls = 0;
  /** Server-side clock, so the script's own TIME call is what drives the window. */
  let serverNow = 1_800_000_000_000;

  function entries(key: string): { member: string; score: number }[] {
    const expiresAt = expiries.get(key);
    if (expiresAt !== undefined && serverNow > expiresAt) {
      sets.delete(key);
      expiries.delete(key);
    }
    return sets.get(key) ?? [];
  }

  const client: GenericRedisClient = {
    async get() {
      return null;
    },
    async set() {
      return 'OK';
    },
    async del(key) {
      return sets.delete(key) ? 1 : 0;
    },
    async keys() {
      return [...sets.keys()];
    },
    async eval(_script, numKeys, ...args) {
      evalCalls += 1;

      const key = String(args[Number(numKeys) - 1]);
      const [windowRaw, maxRaw, member] = args.slice(Number(numKeys));
      const windowMs = Number(windowRaw);
      const maxCalls = Number(maxRaw);
      const now = serverNow;

      // ZREMRANGEBYSCORE key 0 (now - windowMs)
      const kept = entries(key).filter((entry) => entry.score > now - windowMs);
      sets.set(key, kept);

      // ZCARD
      if (kept.length >= maxCalls) {
        // ZRANGE key 0 0 WITHSCORES -> oldest score
        const oldest = [...kept].sort((a, b) => a.score - b.score)[0];
        const retryAfterMs = oldest ? Math.max(0, oldest.score + windowMs - now) : windowMs;
        return [0, retryAfterMs];
      }

      // ZADD replaces an identical member rather than appending.
      const existing = kept.find((entry) => entry.member === String(member));
      if (existing) {
        existing.score = now;
      } else {
        kept.push({ member: String(member), score: now });
      }
      sets.set(key, kept);
      expiries.set(key, now + windowMs);

      return [1, 0];
    },
  };

  return {
    client,
    reset() {
      sets.clear();
      expiries.clear();
    },
    get evalCalls() {
      return evalCalls;
    },
    membersOf(key: string) {
      return [...(sets.get(key) ?? [])];
    },
    keysOf() {
      return [...sets.keys()];
    },
    /** Moves the server clock forward, standing in for the window elapsing. */
    advance(ms: number) {
      serverNow += ms;
    },
  };
}

export async function runDistributedRateLimitTests() {
  console.log('🚦 Running DistributedRateLimitPolicy Tests (Shared Sliding Window)...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  const ctx: AgentContext = {
    sessionId: 'sess_drl',
    traceId: 'trace_drl',
    security: { userId: 'usr_1', tenantId: 'acme' },
  };

  // TEST 1: the contract suite passes, including the combined-limit assertions
  try {
    const redis = createFakeRedis();
    const result = await runRateLimiterContract({
      name: 'DistributedRateLimitPolicy',
      log: false,
      maxCalls: 3,
      createLimiter: () =>
        new DistributedRateLimitPolicy({ client: redis.client, maxCallsPerWindow: 3 }),
      reset: () => redis.reset(),
    });

    assert(result.failed === 0, 'Test 1a: the limiter passes the contract', result.failures.join(' | '));
    assert(result.skipped === 0, 'Test 1b: no capability was skipped for the distributed limiter');
    assert(result.passed > 10, 'Test 1c: the contract exercises a meaningful number of assertions');
  } catch (err: unknown) {
    assert(false, 'Test 1: contract compliance', String(err));
  }

  // TEST 2: the in-process policy is honestly reported as NOT distributed
  //
  // Proves the contract has teeth: RateLimitPolicy keeps its window in a static
  // map, so two instances share it *within* a process but not across pods. The
  // combined-limit groups are skipped rather than falsely passed.
  try {
    const result = await runRateLimiterContract({
      name: 'RateLimitPolicy',
      log: false,
      maxCalls: 3,
      enforcesCombinedLimit: false,
      createLimiter: () =>
        new RateLimitPolicy({ maxCallsPerMinute: 3, sweepIntervalMs: 0 }),
      // A process-local static map cannot be cleared through the public API, so
      // each group is isolated by using a distinct tool name instead.
      reset: () => {
        const history = (RateLimitPolicy as unknown as { history: Map<string, number[]> }).history;
        history.clear();
      },
    });

    assert(result.failed === 0, 'Test 2a: the in-process limiter passes every single-instance assertion', result.failures.join(' | '));
    assert(result.skipped === 2, 'Test 2b: the combined-limit groups are skipped, not silently passed', String(result.skipped));
  } catch (err: unknown) {
    assert(false, 'Test 2: in-process limiter reported honestly', String(err));
  }

  // TEST 3: the limit is enforced atomically in one round trip
  try {
    const redis = createFakeRedis();
    const policy = new DistributedRateLimitPolicy({
      client: redis.client,
      maxCallsPerWindow: 2,
    });

    const before = redis.evalCalls;
    await policy.evaluate(ctx, 'tool_a', {});
    assert(redis.evalCalls === before + 1, 'Test 3a: each evaluation is a single EVAL, so check-and-admit cannot interleave');

    await policy.evaluate(ctx, 'tool_a', {});
    const denied = await policy.evaluate(ctx, 'tool_a', {});
    assert(denied.decision === 'deny', 'Test 3b: the third call exceeds a limit of 2');
  } catch (err: unknown) {
    assert(false, 'Test 3: atomic evaluation', String(err));
  }

  // TEST 4: every call takes its own slot, even on the same clock tick
  //
  // A sorted set treats an identical member as an update. Members derived from
  // pid/timestamp/counter collide across pods -- containers commonly share PID 1
  // and per-instance counters both start at zero -- which silently undercounts.
  try {
    const redis = createFakeRedis();
    const policy = new DistributedRateLimitPolicy({
      client: redis.client,
      maxCallsPerWindow: 2,
    });

    const first = await policy.evaluate(ctx, 'burst_tool', {});
    const second = await policy.evaluate(ctx, 'burst_tool', {});
    const third = await policy.evaluate(ctx, 'burst_tool', {});

    assert(
      first.decision === 'allow' && second.decision === 'allow',
      'Test 4a: two calls on the same server tick both consume a slot',
    );
    assert(third.decision === 'deny', 'Test 4b: the burst hits the limit rather than being undercounted');

    const key = redis.keysOf()[0];
    const members = redis.membersOf(key).map((entry) => entry.member);
    assert(
      new Set(members).size === members.length && members.length === 2,
      'Test 4c: each admitted call holds a distinct member, so none overwrote another',
      members.join(', '),
    );

    // Two policies standing in for two pods must not produce colliding members.
    const podA = new DistributedRateLimitPolicy({ client: redis.client, maxCallsPerWindow: 10 });
    const podB = new DistributedRateLimitPolicy({ client: redis.client, maxCallsPerWindow: 10 });
    await podA.evaluate(ctx, 'cross_pod_tool', {});
    await podB.evaluate(ctx, 'cross_pod_tool', {});

    const crossKey = redis.keysOf().find((k) => k.includes('cross_pod_tool'))!;
    assert(
      redis.membersOf(crossKey).length === 2,
      'Test 4d: two freshly-constructed instances produce distinct members, not one shared slot',
      String(redis.membersOf(crossKey).length),
    );
  } catch (err: unknown) {
    assert(false, 'Test 4: per-call member uniqueness', String(err));
  }

  // TEST 4B: the window is driven by Redis TIME, not the caller's clock
  //
  // Clock skew between pods would otherwise let one instance evict entries
  // another just wrote, widening the effective limit.
  try {
    const redis = createFakeRedis();
    const policy = new DistributedRateLimitPolicy({
      client: redis.client,
      maxCallsPerWindow: 1,
      windowMs: 60_000,
    });

    await policy.evaluate(ctx, 'skew_tool', {});

    // A wildly wrong local clock must not affect the decision.
    const originalNow = Date.now;
    Date.now = () => 0;
    try {
      const denied = await policy.evaluate(ctx, 'skew_tool', {});
      assert(denied.decision === 'deny', 'Test 4B: a skewed local clock does not widen the window');
    } finally {
      Date.now = originalNow;
    }
  } catch (err: unknown) {
    assert(false, 'Test 4B: server-authoritative clock', String(err));
  }

  // TEST 5: the window slides — capacity returns once old calls age out
  try {
    const redis = createFakeRedis();
    const policy = new DistributedRateLimitPolicy({
      client: redis.client,
      maxCallsPerWindow: 2,
      windowMs: 60_000,
    });

    await policy.evaluate(ctx, 'sliding_tool', {});
    await policy.evaluate(ctx, 'sliding_tool', {});
    assert(
      (await policy.evaluate(ctx, 'sliding_tool', {})).decision === 'deny',
      'Test 5a: the window is full',
    );

    redis.advance(61_000);
    assert(
      (await policy.evaluate(ctx, 'sliding_tool', {})).decision === 'allow',
      'Test 5b: capacity returns once the earlier calls fall outside the window',
    );
  } catch (err: unknown) {
    assert(false, 'Test 5: sliding window', String(err));
  }

  // TEST 6: retry-after reflects when a slot actually frees up
  try {
    const redis = createFakeRedis();
    const policy = new DistributedRateLimitPolicy({
      client: redis.client,
      maxCallsPerWindow: 1,
      windowMs: 60_000,
    });

    await policy.evaluate(ctx, 'retry_tool', {});

    // 40s in, the single recorded call has 20s left before it ages out.
    redis.advance(40_000);
    const denied = await policy.evaluate(ctx, 'retry_tool', {});

    assert(denied.decision === 'deny', 'Test 6a: the call is denied');
    if (denied.decision === 'deny') {
      assert(
        denied.retryAfterSeconds === 20,
        'Test 6b: retryAfterSeconds reflects the remaining window, not the full window',
        String(denied.retryAfterSeconds),
      );
      assert(
        denied.reason.includes('Retry after 20s'),
        'Test 6c: the back-off is stated in the reason the model sees',
        denied.reason,
      );
    }
  } catch (err: unknown) {
    assert(false, 'Test 6: retry-after accuracy', String(err));
  }

  // TEST 7: keys carry the configured prefix and expire on their own
  try {
    const redis = createFakeRedis();
    const policy = new DistributedRateLimitPolicy({
      client: redis.client,
      maxCallsPerWindow: 5,
      keyPrefix: 'custom:rl:',
    });

    await policy.evaluate(ctx, 'prefixed_tool', {});
    const keys = await redis.client.keys('*');
    assert(
      keys.some((key) => key.startsWith('custom:rl:')),
      'Test 7a: the configured keyPrefix is applied',
      keys.join(', '),
    );

    const defaults = createFakeRedis();
    await new DistributedRateLimitPolicy({ client: defaults.client }).evaluate(ctx, 'x', {});
    const defaultKeys = await defaults.client.keys('*');
    assert(
      defaultKeys.some((key) => key.startsWith('agentic:ratelimit:')),
      'Test 7b: the default keyPrefix is agentic:ratelimit:',
      defaultKeys.join(', '),
    );
  } catch (err: unknown) {
    assert(false, 'Test 7: key naming', String(err));
  }

  // TEST 8: a client that cannot run EVAL is rejected at construction
  //
  // Silently degrading to a non-atomic read-then-write would leak the limit
  // across concurrent callers, which is exactly what this policy exists to stop.
  try {
    const withoutEval = {
      async get() {
        return null;
      },
      async set() {
        return 'OK';
      },
      async del() {
        return 0;
      },
      async keys() {
        return [];
      },
    };

    let threw: Error | undefined;
    try {
      new DistributedRateLimitPolicy({ client: withoutEval });
    } catch (err) {
      threw = err as Error;
    }

    assert(threw instanceof TypeError, 'Test 8a: a client without eval() is rejected rather than degraded');
    assert(
      Boolean(threw?.message.includes('atomic')),
      'Test 8b: the error explains why an atomic script is required',
      threw?.message,
    );
    assert(
      Boolean(threw?.message.includes('node-redis v4')),
      'Test 8c: the error points at the evalFn adapter for clients with a different signature',
    );
  } catch (err: unknown) {
    assert(false, 'Test 8: eval capability requirement', String(err));
  }

  // TEST 8B: a client with a different eval signature works through evalFn
  //
  // node-redis v4 uses eval(script, { keys, arguments }), which would pass a bare
  // typeof check and then fail at runtime against the positional form.
  try {
    const redis = createFakeRedis();
    const calls: { keys: string[]; args: string[] }[] = [];

    const nodeRedisV4Style = {
      async eval(script: string, opts: { keys: string[]; arguments: string[] }) {
        calls.push({ keys: opts.keys, args: opts.arguments });
        // Delegate to the positional fake so the real algorithm still runs.
        return redis.client.eval!(script, opts.keys.length, ...opts.keys, ...opts.arguments);
      },
    };

    const policy = new DistributedRateLimitPolicy({
      maxCallsPerWindow: 1,
      evalFn: (script, keys, args) =>
        nodeRedisV4Style.eval(script, { keys, arguments: args.map(String) }),
    });

    const allowed = await policy.evaluate(ctx, 'v4_tool', {});
    const denied = await policy.evaluate(ctx, 'v4_tool', {});

    assert(allowed.decision === 'allow', 'Test 8B-a: the evalFn adapter drives a successful evaluation');
    assert(denied.decision === 'deny', 'Test 8B-b: the limit is still enforced through the adapter');
    assert(calls.length === 2 && calls[0].keys.length === 1, 'Test 8B-c: the adapter receives keys and args separately');
  } catch (err: unknown) {
    assert(false, 'Test 8B: evalFn adapter', String(err));
  }

  // TEST 9: invalid configuration is rejected at construction
  try {
    const redis = createFakeRedis();

    const cases: Array<[string, () => void]> = [
      ['a zero limit', () => new DistributedRateLimitPolicy({ client: redis.client, maxCallsPerWindow: 0 })],
      ['a negative limit', () => new DistributedRateLimitPolicy({ client: redis.client, maxCallsPerWindow: -1 })],
      ['a fractional limit', () => new DistributedRateLimitPolicy({ client: redis.client, maxCallsPerWindow: 1.5 })],
      ['a zero window', () => new DistributedRateLimitPolicy({ client: redis.client, windowMs: 0 })],
      ['a NaN window', () => new DistributedRateLimitPolicy({ client: redis.client, windowMs: Number.NaN })],
    ];

    const rejected = cases.filter(([, construct]) => {
      try {
        construct();
        return false;
      } catch {
        return true;
      }
    });

    assert(
      rejected.length === cases.length,
      'Test 9: every invalid limit/window is rejected at construction',
      `${rejected.length} of ${cases.length}`,
    );
  } catch (err: unknown) {
    assert(false, 'Test 9: configuration validation', String(err));
  }

  // TEST 10: a malformed script result surfaces instead of failing open
  try {
    const brokenClient = {
      async get() {
        return null;
      },
      async set() {
        return 'OK';
      },
      async del() {
        return 0;
      },
      async keys() {
        return [];
      },
      async eval() {
        return 'not-an-array';
      },
    };

    const policy = new DistributedRateLimitPolicy({ client: brokenClient });

    let threw = false;
    try {
      await policy.evaluate(ctx, 'broken_tool', {});
    } catch {
      threw = true;
    }

    assert(threw, 'Test 10: an unexpected script result throws rather than being read as "allowed"');
  } catch (err: unknown) {
    assert(false, 'Test 10: malformed script result', String(err));
  }

  console.log(`\n  📊 DistributedRateLimitPolicy Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('DistributedRateLimitPolicy Unit Tests Failed');
  }
}

if (require.main === module) {
  runDistributedRateLimitTests().catch(() => process.exit(1));
}
