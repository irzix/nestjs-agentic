import 'reflect-metadata';
import { CostLimitPolicy, RateLimitPolicy } from '../src';
import type { AgentContext } from '../src';

export async function runPolicyTests() {
  console.log('⚖️ Running Advanced Governance Policies Unit Tests...\n');

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

  const dummyCtx: AgentContext = {
    sessionId: 'sess_policy',
    traceId: 'trace_policy',
    security: { userId: 'usr_buyer', tenantId: 'acme' },
  };

  // TEST 1: CostLimitPolicy Thresholds
  try {
    const policy = new CostLimitPolicy({
      paramName: 'amount',
      autoAllowLimit: 500,
      approvalLimit: 5000,
    });

    const res1 = await policy.evaluate(dummyCtx, 'transfer', { amount: 300 });
    assert(res1.decision === 'allow', 'Test 1a: Amount $300 is auto-allowed');

    const res2 = await policy.evaluate(dummyCtx, 'transfer', { amount: 1500 });
    assert(res2.decision === 'require_approval', 'Test 1b: Amount $1500 requires approval');

    const res3 = await policy.evaluate(dummyCtx, 'transfer', { amount: 10000 });
    assert(res3.decision === 'deny', 'Test 1c: Amount $10000 exceeds safety threshold and is denied');
  } catch (err: any) {
    assert(false, 'Test 1: CostLimitPolicy Thresholds', err.message);
  }

  // TEST 2: RateLimitPolicy Evaluation
  try {
    const ratePolicy = new RateLimitPolicy({ maxCallsPerMinute: 3 });
    const toolName = 'rateLimitedAction';

    const r1 = await ratePolicy.evaluate(dummyCtx, toolName, {});
    const r2 = await ratePolicy.evaluate(dummyCtx, toolName, {});
    const r3 = await ratePolicy.evaluate(dummyCtx, toolName, {});
    assert(
      r1.decision === 'allow' && r2.decision === 'allow' && r3.decision === 'allow',
      'Test 2a: First 3 tool calls allowed within limit',
    );

    const r4 = await ratePolicy.evaluate(dummyCtx, toolName, {});
    assert(
      r4.decision === 'deny' && r4.reason.includes('Rate limit exceeded'),
      'Test 2b: 4th tool call denied due to rate limit threshold',
    );
  } catch (err: any) {
    assert(false, 'Test 2: RateLimitPolicy Evaluation', err.message);
  }

  console.log(`\n  📊 Policies Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Policy Unit Tests Failed');
  }
}

if (require.main === module) {
  runPolicyTests().catch(() => process.exit(1));
}
