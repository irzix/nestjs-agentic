import 'reflect-metadata';
import {
  CONTRACT_USER_MESSAGE,
  MockModelAdapter,
  runModelAdapterContract,
} from '../src';
import type { ModelAdapter, ModelRequest, ModelResponse } from '../src';

/** Adapter that violates several contract points, used to prove the suite detects them. */
class NonCompliantAdapter implements ModelAdapter {
  async generate(_request: ModelRequest): Promise<ModelResponse> {
    return {
      // Contract requires a string, and tool call args must be a parsed object.
      content: undefined as unknown as string,
      toolCalls: [
        {
          id: '',
          name: 'lookupOrder',
          args: '{"orderId":"42"}' as unknown as Record<string, unknown>,
        },
      ],
      finishReason: 'made_up' as ModelResponse['finishReason'],
    };
  }
}

export async function runModelAdapterContractTests() {
  console.log('📜 Running Step 9: ModelAdapter Contract Suite Tests...\n');

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

  // TEST 1: The reference mock adapter satisfies the contract
  try {
    const result = await runModelAdapterContract({
      name: 'MockModelAdapter',
      log: false,
      createAdapter: (scenario) => {
        const adapter = new MockModelAdapter(
          scenario.usage ? { usagePerRound: scenario.usage } : undefined,
        );
        const script = adapter.whenAsked(CONTRACT_USER_MESSAGE);

        if (scenario.toolCalls?.length) {
          script.callTools(
            scenario.toolCalls.map((call) => ({
              name: call.name,
              args: call.args,
              id: call.id,
            })),
            { content: scenario.content },
          );
        } else {
          script.reply(scenario.content ?? '');
        }

        return adapter;
      },
    });

    assert(
      result.failed === 0,
      'Test 1a: MockModelAdapter passes the contract',
      result.failures.join(' | '),
    );
    assert(result.passed > 15, 'Test 1b: Contract exercises a meaningful number of assertions');
    assert(result.skipped === 0, 'Test 1c: No capability was skipped for the mock adapter');
  } catch (err: any) {
    assert(false, 'Test 1: Mock adapter contract', err.message);
  }

  // TEST 2: The suite detects a non-compliant adapter
  try {
    const result = await runModelAdapterContract({
      name: 'NonCompliantAdapter',
      log: false,
      supportsStreaming: false,
      createAdapter: () => new NonCompliantAdapter(),
    });

    assert(result.failed > 0, 'Test 2a: Violations are reported as failures');
    assert(
      result.failures.some((f) => f.includes('parsed object')),
      'Test 2b: String tool arguments detected',
      result.failures.join(' | '),
    );
    assert(
      result.failures.some((f) => f.includes('correlation id')),
      'Test 2c: Missing tool call id detected',
    );
    assert(
      result.failures.some((f) => f.includes('finish reason')),
      'Test 2d: Unknown finish reason detected',
    );
    assert(
      result.failures.some((f) => f.includes('cancellation') || f.includes('aborted')),
      'Test 2e: Ignored cancellation detected',
    );
    assert(result.skipped === 1, 'Test 2f: Streaming assertions skipped when unsupported');
  } catch (err: any) {
    assert(false, 'Test 2: Non-compliant adapter detection', err.message);
  }

  console.log(`\n  📊 Step 9 Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Step 9 Unit Tests Failed');
  }
}

if (require.main === module) {
  runModelAdapterContractTests().catch(() => process.exit(1));
}
