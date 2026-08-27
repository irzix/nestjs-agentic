import type { AgentContext } from '../interfaces/agent-context.interface';
import type { ToolPolicy } from '../interfaces/policy.interface';

/** Tool name the harness rate-limits. */
export const CONTRACT_RATE_LIMITED_TOOL = 'contractRateLimitedTool';

export interface RateLimiterContractOptions {
  /** Limiter name used in the report. */
  name: string;

  /**
   * Calls allowed per window. The harness configures its limiters with this, so
   * it knows where the boundary should fall.
   */
  maxCalls: number;

  /**
   * Builds a limiter. Called more than once per group: `createLimiter()` twice in
   * the same group must produce two limiters that *share* their backend, standing
   * in for two pods of one deployment.
   */
  createLimiter(): ToolPolicy | Promise<ToolPolicy>;

  /**
   * Discards all recorded state, so each group starts from a clean window.
   * Required because a limiter's state usually outlives the instance.
   */
  reset(): void | Promise<void>;

  /**
   * Set false for a limiter whose state is process-local, so N instances each
   * admit `maxCalls` independently. The combined-limit assertions are then
   * skipped rather than reported as failures.
   *
   * Default: true
   */
  enforcesCombinedLimit?: boolean;

  /**
   * Set false when the limiter does not report back-off timing on a denial.
   * Default: true
   */
  reportsRetryAfter?: boolean;

  /** Set false to keep the report quiet. Default: true */
  log?: boolean;
}

export interface RateLimiterContractResult {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  failures: string[];
}

/**
 * Behavioral contract for a rate-limit `ToolPolicy`.
 *
 * A compliant limiter admits up to its configured limit within a window, denies
 * beyond it, keys windows independently per tenant/user/tool, and — when it claims
 * to be distributed — enforces one *combined* limit across instances sharing a
 * backend rather than one limit each.
 *
 * That last property is the one a naive test misses: a limiter holding its window
 * in process memory passes every single-instance assertion and then silently
 * multiplies the limit by the pod count in production.
 *
 * @example
 * const result = await runRateLimiterContract({
 *   name: 'MyRateLimiter',
 *   maxCalls: 3,
 *   createLimiter: () => new MyRateLimiter({ client: sharedRedis, maxCallsPerWindow: 3 }),
 *   reset: () => sharedRedis.flush(),
 * });
 * if (result.failed > 0) throw new Error('Limiter is not contract compliant');
 */
export async function runRateLimiterContract(
  options: RateLimiterContractOptions,
): Promise<RateLimiterContractResult> {
  const enforcesCombinedLimit = options.enforcesCombinedLimit ?? true;
  const reportsRetryAfter = options.reportsRetryAfter ?? true;
  const log = options.log ?? true;
  const { maxCalls } = options;

  const result: RateLimiterContractResult = {
    name: options.name,
    passed: 0,
    failed: 0,
    skipped: 0,
    failures: [],
  };

  function pass(assertion: string) {
    result.passed++;
    if (log) console.log(`  ✅ PASS: ${assertion}`);
  }

  function fail(assertion: string, detail?: string) {
    result.failed++;
    result.failures.push(detail ? `${assertion} (${detail})` : assertion);
    if (log) console.error(`  ❌ FAIL: ${assertion} ${detail ? `(${detail})` : ''}`);
  }

  function check(condition: boolean, assertion: string, detail?: string) {
    if (condition) pass(assertion);
    else fail(assertion, detail);
  }

  function skip(assertion: string) {
    result.skipped++;
    if (log) console.log(`  ⏭️  SKIP: ${assertion}`);
  }

  if (log) {
    console.log(`\n🚦 Rate limiter contract: ${options.name}\n`);
  }

  // GROUP 1: calls up to the limit are admitted, and the next one is denied
  try {
    await options.reset();
    const limiter = await options.createLimiter();
    const ctx = buildContext('tenant_1', 'user_1');

    const admitted: string[] = [];
    for (let i = 0; i < maxCalls; i++) {
      admitted.push((await limiter.evaluate(ctx, CONTRACT_RATE_LIMITED_TOOL, {})).decision);
    }

    check(
      admitted.every((decision) => decision === 'allow'),
      `the first ${maxCalls} calls within the window are allowed`,
      admitted.join(', '),
    );

    const overflow = await limiter.evaluate(ctx, CONTRACT_RATE_LIMITED_TOOL, {});
    check(overflow.decision === 'deny', `call ${maxCalls + 1} is denied`, overflow.decision);
    check(
      overflow.decision === 'deny' && overflow.reason.length > 0,
      'the denial carries a reason',
    );
  } catch (err) {
    fail('admits up to the limit and denies beyond it', describe(err));
  }

  // GROUP 2: windows are keyed independently per tenant, user, and tool
  try {
    await options.reset();
    const limiter = await options.createLimiter();

    // Exhaust one caller's window.
    const exhausted = buildContext('tenant_1', 'user_1');
    for (let i = 0; i < maxCalls; i++) {
      await limiter.evaluate(exhausted, CONTRACT_RATE_LIMITED_TOOL, {});
    }
    check(
      (await limiter.evaluate(exhausted, CONTRACT_RATE_LIMITED_TOOL, {})).decision === 'deny',
      'the exhausted caller is denied',
    );

    const otherUser = await limiter.evaluate(
      buildContext('tenant_1', 'user_2'),
      CONTRACT_RATE_LIMITED_TOOL,
      {},
    );
    check(otherUser.decision === 'allow', 'a different user has an independent window');

    const otherTenant = await limiter.evaluate(
      buildContext('tenant_2', 'user_1'),
      CONTRACT_RATE_LIMITED_TOOL,
      {},
    );
    check(otherTenant.decision === 'allow', 'a different tenant has an independent window');

    const otherTool = await limiter.evaluate(exhausted, 'someOtherTool', {});
    check(otherTool.decision === 'allow', 'a different tool has an independent window');
  } catch (err) {
    fail('keys windows per tenant, user, and tool', describe(err));
  }

  // GROUP 3: a denial reports when to retry
  if (!reportsRetryAfter) {
    skip('a denial reports retryAfterSeconds');
  } else {
    try {
      await options.reset();
      const limiter = await options.createLimiter();
      const ctx = buildContext('tenant_1', 'user_1');

      for (let i = 0; i < maxCalls; i++) {
        await limiter.evaluate(ctx, CONTRACT_RATE_LIMITED_TOOL, {});
      }
      const denied = await limiter.evaluate(ctx, CONTRACT_RATE_LIMITED_TOOL, {});

      const retryAfter = denied.decision === 'deny' ? denied.retryAfterSeconds : undefined;
      check(typeof retryAfter === 'number', 'a denial reports retryAfterSeconds', String(retryAfter));
      check(
        typeof retryAfter === 'number' && retryAfter >= 1,
        'retryAfterSeconds is at least 1, so it cannot invite an immediate doomed retry',
        String(retryAfter),
      );
      check(
        denied.decision === 'deny' && /retry after/i.test(denied.reason),
        'the reason text also states the back-off, since that is what reaches the model',
      );
    } catch (err) {
      fail('reports retry-after on denial', describe(err));
    }
  }

  // GROUP 4: instances sharing a backend enforce one combined limit
  //
  // This is the assertion that separates a distributed limiter from a
  // process-local one: two pods must not each get the full allowance.
  if (!enforcesCombinedLimit) {
    skip('instances sharing a backend enforce a combined limit');
  } else {
    try {
      await options.reset();
      const podA = await options.createLimiter();
      const podB = await options.createLimiter();
      const ctx = buildContext('tenant_1', 'user_1');

      // Alternate between pods so neither one alone reaches the limit.
      const decisions: string[] = [];
      for (let i = 0; i < maxCalls * 2; i++) {
        const pod = i % 2 === 0 ? podA : podB;
        decisions.push((await pod.evaluate(ctx, CONTRACT_RATE_LIMITED_TOOL, {})).decision);
      }

      const allowed = decisions.filter((decision) => decision === 'allow').length;
      check(
        allowed === maxCalls,
        `two instances share one limit of ${maxCalls}, not one each`,
        `${allowed} calls were allowed across ${maxCalls * 2} attempts`,
      );
      check(
        decisions.slice(0, maxCalls).every((decision) => decision === 'allow'),
        'the shared allowance is consumed in call order',
      );

      // A fresh instance must see the exhausted window too, not start over.
      const podC = await options.createLimiter();
      check(
        (await podC.evaluate(ctx, CONTRACT_RATE_LIMITED_TOOL, {})).decision === 'deny',
        'an instance created after the limit is reached also observes it',
      );
    } catch (err) {
      fail('enforces a combined limit across instances', describe(err));
    }
  }

  // GROUP 5: concurrent callers cannot both take the last slot
  if (!enforcesCombinedLimit) {
    skip('concurrent callers cannot exceed the limit');
  } else {
    try {
      await options.reset();
      const podA = await options.createLimiter();
      const podB = await options.createLimiter();
      const ctx = buildContext('tenant_1', 'user_1');

      // Fill every slot but one, then race two pods for it.
      for (let i = 0; i < maxCalls - 1; i++) {
        await podA.evaluate(ctx, CONTRACT_RATE_LIMITED_TOOL, {});
      }

      const raced = await Promise.all([
        podA.evaluate(ctx, CONTRACT_RATE_LIMITED_TOOL, {}),
        podB.evaluate(ctx, CONTRACT_RATE_LIMITED_TOOL, {}),
      ]);
      const wonTheRace = raced.filter((decision) => decision.decision === 'allow').length;

      check(
        wonTheRace === 1,
        'exactly one of two concurrent callers takes the last slot',
        `${wonTheRace} callers were admitted`,
      );
    } catch (err) {
      fail('admits only one concurrent caller into the last slot', describe(err));
    }
  }

  if (log) {
    console.log(
      `\n  📊 ${options.name} contract: ${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped.\n`,
    );
  }

  return result;
}

/** Builds a context scoped to one tenant/user pair. */
function buildContext(tenantId: string, userId: string): AgentContext {
  return {
    sessionId: `sess_${tenantId}_${userId}`,
    traceId: `trace_${tenantId}_${userId}`,
    security: { tenantId, userId },
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
