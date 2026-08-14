import 'reflect-metadata';
import {
  IdempotencyPolicy,
  InMemoryIdempotencyStore,
  LocalToolProvider,
  RedisIdempotencyStore,
  ToolDiscoveryService,
  runIdempotencyStoreContract,
} from '../src';
import type { GenericRedisClient } from '../src';

function createFakeRedis() {
  const storage = new Map<string, string>();
  const client: GenericRedisClient = {
    async get(key) {
      return storage.get(key) ?? null;
    },
    async set(key, value) {
      storage.set(key, value);
      return 'OK';
    },
    async del(key) {
      return storage.delete(key) ? 1 : 0;
    },
    async keys(pattern) {
      const prefix = pattern.replace(/\*$/, '');
      return [...storage.keys()].filter((key) => key.startsWith(prefix));
    },
  };
  return { client, storage };
}

export async function runIdempotencyTests() {
  console.log('🧪 Running Idempotency Contract and Execution Tests...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) {
      passed++;
      console.log(`  ✅ PASS: ${name}`);
    } else {
      failed++;
      console.error(`  ❌ FAIL: ${name}`);
    }
  }

  // 1. InMemory contract
  {
    const res = await runIdempotencyStoreContract({
      name: 'InMemoryIdempotencyStore',
      createStore: () => new InMemoryIdempotencyStore(),
    });
    assert(res.failed === 0, 'Test 1: InMemoryIdempotencyStore passes contract');
  }

  // 2. Redis contract
  {
    const { client } = createFakeRedis();
    const res = await runIdempotencyStoreContract({
      name: 'RedisIdempotencyStore',
      createStore: () => new RedisIdempotencyStore({ client }),
    });
    assert(res.failed === 0, 'Test 2: RedisIdempotencyStore passes contract');
  }

  // 3. Tool deduplication via LocalToolProvider
  {
    const store = new InMemoryIdempotencyStore();
    let executionCount = 0;

    class TestTools {
      async transfer(args: { amount: number }) {
        executionCount++;
        return { txId: `tx_${args.amount}_${executionCount}` };
      }
    }

    const toolInstance = new TestTools();
    const discovery = new ToolDiscoveryService();
    // Simulate discovered tool
    (discovery as any).discover = () => ({
      tools: [
        {
          toolName: 'transfer',
          methodName: 'transfer',
          description: 'Transfer funds',
          instance: toolInstance,
          params: [{ name: 'amount', index: 0, type: 'number', required: true }],
          policyConstructors: [],
        },
      ],
      classPolicyConstructors: [],
    });

    const provider = new LocalToolProvider([], {} as any, discovery, {} as any, undefined, store);
    const resolved = provider.buildTools([TestTools], {
      sessionId: 's1',
      traceId: 't1',
      security: {},
      data: {},
    });

    const call1 = await resolved[0].execute({
      args: { amount: 100, idempotencyKey: 'idem_tx_100' },
    });
    assert(call1.success === true && executionCount === 1, 'Test 3a: First call executes tool method');

    const call2 = await resolved[0].execute({
      args: { amount: 100, idempotencyKey: 'idem_tx_100' },
    });
    assert(
      call2.success === true &&
        executionCount === 1 &&
        (call2 as any).data?.txId === (call1 as any).data?.txId,
      'Test 3b: Repeated call with same key returns cached result without re-executing',
    );
  }

  // 4. IdempotencyPolicy validation
  {
    const policy = new IdempotencyPolicy({ required: true });
    const resDeny = await policy.evaluate({ sessionId: 's1', traceId: 't1', security: {}, data: {} }, 'transfer', {});
    assert(resDeny.decision === 'deny', 'Test 4a: Missing idempotencyKey is denied when required');

    const resAllow = await policy.evaluate(
      { sessionId: 's1', traceId: 't1', security: {}, data: {} },
      'transfer',
      { idempotencyKey: 'key_123' },
    );
    assert(resAllow.decision === 'allow', 'Test 4b: Present idempotencyKey is allowed');
  }

  console.log(`\n  📊 Idempotency Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) throw new Error('Idempotency Tests Failed');
}

if (require.main === module) {
  runIdempotencyTests().catch(() => process.exit(1));
}
