import type { IdempotencyRecord, IdempotencyStore } from '../interfaces/idempotency.interface';

export interface IdempotencyStoreContractOptions {
  /** Store name in test output. */
  name: string;
  /** Factory to build an empty store instance. */
  createStore(): IdempotencyStore | Promise<IdempotencyStore>;
  /** Whether to log assertion results. Default: true. */
  log?: boolean;
}

export interface IdempotencyStoreContractResult {
  name: string;
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * Behavioral contract test suite for `IdempotencyStore`.
 */
export async function runIdempotencyStoreContract(
  options: IdempotencyStoreContractOptions,
): Promise<IdempotencyStoreContractResult> {
  const log = options.log ?? true;
  const result: IdempotencyStoreContractResult = {
    name: options.name,
    passed: 0,
    failed: 0,
    failures: [],
  };

  function check(condition: boolean, assertion: string) {
    if (condition) {
      result.passed++;
      if (log) console.log(`  ✅ PASS: ${assertion}`);
    } else {
      result.failed++;
      result.failures.push(assertion);
      if (log) console.error(`  ❌ FAIL: ${assertion}`);
    }
  }

  if (log) console.log(`\n🔧 IdempotencyStore contract: ${options.name}\n`);

  const sample: IdempotencyRecord = {
    key: 'idem_key_1',
    toolName: 'transferFunds',
    result: { success: true, data: { txId: 'tx_123' } },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
  };

  // 1. Missing key
  {
    const store = await options.createStore();
    const loaded = await store.get('missing');
    check(loaded === null, 'get() returns null for unknown key');
  }

  // 2. Round-trip
  {
    const store = await options.createStore();
    await store.save(sample);
    const loaded = await store.get(sample.key);
    check(loaded?.key === sample.key, 'key matches stored record');
    check(loaded?.toolName === sample.toolName, 'toolName matches stored record');
    check(loaded?.result?.success === true, 'result preserved');
    check(loaded?.createdAt instanceof Date, 'createdAt revived as Date');
    check(loaded?.expiresAt instanceof Date, 'expiresAt revived as Date');
  }

  // 3. Delete
  {
    const store = await options.createStore();
    await store.save(sample);
    await store.delete(sample.key);
    const loaded = await store.get(sample.key);
    check(loaded === null, 'delete() removes record');
  }

  // 4. Overwrite
  {
    const store = await options.createStore();
    await store.save(sample);
    const updated: IdempotencyRecord = {
      ...sample,
      result: { success: false, status: 'denied', reason: 'Overwritten' },
    };
    await store.save(updated);
    const loaded = await store.get(sample.key);
    check(loaded?.result?.success === false && (loaded.result as any).status === 'denied', 'subsequent save() overwrites record');
  }

  // 5. Mutation isolation
  {
    const store = await options.createStore();
    await store.save(sample);
    const loaded1 = await store.get(sample.key);
    if (loaded1?.result) {
      (loaded1.result as any).data = { mutated: true };
    }
    const loaded2 = await store.get(sample.key);
    check((loaded2?.result as any)?.data?.txId === 'tx_123', 'modifying loaded record does not mutate store');
  }

  if (log) {
    console.log(`\n  📊 ${options.name} contract: ${result.passed} passed, ${result.failed} failed.\n`);
  }

  return result;
}
