import 'reflect-metadata';
import {
  InMemoryApprovalStore,
  RedisApprovalStore,
  runApprovalStoreContract,
} from '../src';
import type {
  ApprovalStore,
  GenericRedisClient,
  PendingApproval,
} from '../src';

/** Recorded `set` call, used to assert how a TTL was applied. */
interface RecordedSet {
  key: string;
  value: string;
  mode?: string;
  duration?: number;
}

/**
 * Minimal in-process stand-in for a Redis client.
 *
 * Only the commands `GenericRedisClient` declares are implemented, so the store
 * is exercised through the same surface it uses in production. `getdel` is
 * optional so both the atomic claim path and the get+del fallback can be
 * covered.
 */
function createFakeRedis(options: { withGetDel: boolean }) {
  const storage = new Map<string, string>();
  const sets: RecordedSet[] = [];

  const client: GenericRedisClient = {
    async get(key) {
      return storage.get(key) ?? null;
    },
    async set(key, value, mode, duration) {
      sets.push({ key, value, mode, duration });
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

  if (options.withGetDel) {
    client.getdel = async (key) => {
      const value = storage.get(key) ?? null;
      storage.delete(key);
      return value;
    };
  }

  return { client, storage, sets };
}

/** Store that shares live references and never revives Dates, to prove the suite detects it. */
class NonCompliantApprovalStore implements ApprovalStore {
  private readonly store = new Map<string, PendingApproval>();

  async save(approval: PendingApproval): Promise<void> {
    // Serializes on write but not on read, so `createdAt` comes back as a
    // string and the stored object is handed out directly.
    this.store.set(approval.id, JSON.parse(JSON.stringify(approval)));
  }

  async get(id: string): Promise<PendingApproval | null> {
    return this.store.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async claim(id: string): Promise<PendingApproval | null> {
    // Awaits before deleting, so concurrent callers can both observe the record.
    const found = this.store.get(id);
    if (!found) return null;
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.store.delete(id);
    return found;
  }
}

function buildApproval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: 'apr_specific',
    agentName: 'banker',
    toolName: 'transferMoney',
    args: { amount: 2500 },
    context: {
      sessionId: 'sess_1',
      traceId: 'trace_1',
      security: { tenantId: 'tenant_1' },
    },
    reason: 'Exceeds the automatic limit.',
    createdAt: new Date('2026-01-15T10:30:00.000Z'),
    toolCallId: 'call_1',
    ...overrides,
  };
}

export async function runApprovalStoreContractTests() {
  console.log('🗄️  Running Step 11: ApprovalStore Contract Suite Tests...\n');

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

  // TEST 1: InMemoryApprovalStore satisfies the contract
  try {
    const result = await runApprovalStoreContract({
      name: 'InMemoryApprovalStore',
      log: false,
      createStore: () => new InMemoryApprovalStore(),
    });

    assert(
      result.failed === 0,
      'Test 1a: InMemoryApprovalStore passes the contract',
      result.failures.join(' | '),
    );
    assert(result.passed > 25, 'Test 1b: Contract exercises a meaningful number of assertions');
    assert(result.skipped === 0, 'Test 1c: No capability was skipped for the in-memory store');
  } catch (err: any) {
    assert(false, 'Test 1: In-memory store contract', err.message);
  }

  // TEST 2: RedisApprovalStore satisfies the contract when GETDEL is available
  try {
    const result = await runApprovalStoreContract({
      name: 'RedisApprovalStore',
      log: false,
      createStore: () =>
        new RedisApprovalStore({ client: createFakeRedis({ withGetDel: true }).client }),
    });

    assert(
      result.failed === 0,
      'Test 2a: RedisApprovalStore passes the contract',
      result.failures.join(' | '),
    );
    assert(result.skipped === 0, 'Test 2b: No capability was skipped with GETDEL available');
  } catch (err: any) {
    assert(false, 'Test 2: Redis store contract', err.message);
  }

  // TEST 3: The GETDEL fallback still satisfies everything but atomicity
  try {
    const result = await runApprovalStoreContract({
      name: 'RedisApprovalStore (no GETDEL)',
      log: false,
      // The fallback is a non-atomic get+del, so concurrency is not claimed.
      supportsAtomicClaim: false,
      createStore: () =>
        new RedisApprovalStore({ client: createFakeRedis({ withGetDel: false }).client }),
    });

    assert(
      result.failed === 0,
      'Test 3a: The get+del fallback passes every non-concurrency assertion',
      result.failures.join(' | '),
    );
    assert(result.skipped === 1, 'Test 3b: Atomicity assertions are skipped, not silently passed');
  } catch (err: any) {
    assert(false, 'Test 3: Redis fallback contract', err.message);
  }

  // TEST 4: The suite detects a non-compliant store
  try {
    const result = await runApprovalStoreContract({
      name: 'NonCompliantApprovalStore',
      log: false,
      createStore: () => new NonCompliantApprovalStore(),
    });

    assert(result.failed > 0, 'Test 4a: Violations are reported as failures');
    assert(
      result.failures.some((f) => f.includes('createdAt round-trips as a Date')),
      'Test 4b: A Date returned as a string is detected',
      result.failures.join(' | '),
    );
    assert(
      result.failures.some((f) => f.includes('does not change the stored')),
      'Test 4c: Leaking a live reference is detected',
    );
    assert(
      result.failures.some((f) => f.includes('atomic under concurrent callers')),
      'Test 4d: A non-atomic claim is detected',
    );
  } catch (err: any) {
    assert(false, 'Test 4: Non-compliant store detection', err.message);
  }

  // TEST 5: Redis key naming and prefixing
  try {
    const { client, storage } = createFakeRedis({ withGetDel: true });
    const store = new RedisApprovalStore({ client, keyPrefix: 'custom:approval:' });

    await store.save(buildApproval({ id: 'apr_prefixed' }));

    assert(
      storage.has('custom:approval:apr_prefixed'),
      'Test 5a: keyPrefix is applied to stored keys',
      [...storage.keys()].join(', '),
    );

    const defaults = createFakeRedis({ withGetDel: true });
    await new RedisApprovalStore({ client: defaults.client }).save(
      buildApproval({ id: 'apr_default' }),
    );

    assert(
      defaults.storage.has('agentic:approval:apr_default'),
      'Test 5b: The default keyPrefix is agentic:approval:',
      [...defaults.storage.keys()].join(', '),
    );
  } catch (err: any) {
    assert(false, 'Test 5: Redis key naming', err.message);
  }

  // TEST 6: Key TTL is derived from expiresAt plus the grace window
  try {
    const { client, sets } = createFakeRedis({ withGetDel: true });
    const store = new RedisApprovalStore({ client, expiryGraceSeconds: 60 });

    await store.save(
      buildApproval({ id: 'apr_ttl', expiresAt: new Date(Date.now() + 600_000) }),
    );

    const applied = sets[0];
    assert(applied?.mode === 'EX', 'Test 6a: An expiring approval is stored with a TTL');
    // 600s until expiry + 60s grace, allowing a second of scheduling slack.
    assert(
      typeof applied?.duration === 'number' &&
        applied.duration >= 659 &&
        applied.duration <= 661,
      'Test 6b: TTL is time-until-expiry plus the grace window',
      String(applied?.duration),
    );
  } catch (err: any) {
    assert(false, 'Test 6: TTL derived from expiresAt', err.message);
  }

  // TEST 7: An already-expired approval keeps a positive TTL so it stays observable
  try {
    const { client, sets } = createFakeRedis({ withGetDel: true });
    const store = new RedisApprovalStore({ client, expiryGraceSeconds: 45 });

    await store.save(
      buildApproval({ id: 'apr_past', expiresAt: new Date(Date.now() - 600_000) }),
    );

    const applied = sets[0];
    assert(
      typeof applied?.duration === 'number' && applied.duration > 0,
      'Test 7a: A past expiresAt never produces a non-positive TTL',
      String(applied?.duration),
    );
    assert(
      applied?.duration === 45,
      'Test 7b: The grace window is the floor, keeping the expiry reportable',
      String(applied?.duration),
    );
  } catch (err: any) {
    assert(false, 'Test 7: Expired approval TTL floor', err.message);
  }

  // TEST 8: ttlSeconds is the fallback only for approvals without expiresAt
  try {
    const withFallback = createFakeRedis({ withGetDel: true });
    await new RedisApprovalStore({ client: withFallback.client, ttlSeconds: 900 }).save(
      buildApproval({ id: 'apr_fallback' }),
    );

    assert(
      withFallback.sets[0]?.mode === 'EX' && withFallback.sets[0]?.duration === 900,
      'Test 8a: ttlSeconds applies when the approval has no expiresAt',
      String(withFallback.sets[0]?.duration),
    );

    const overridden = createFakeRedis({ withGetDel: true });
    await new RedisApprovalStore({
      client: overridden.client,
      ttlSeconds: 900,
      expiryGraceSeconds: 30,
    }).save(buildApproval({ id: 'apr_own_expiry', expiresAt: new Date(Date.now() + 60_000) }));

    assert(
      overridden.sets[0]?.duration === 90,
      'Test 8b: An approval with expiresAt ignores ttlSeconds',
      String(overridden.sets[0]?.duration),
    );

    const noTtl = createFakeRedis({ withGetDel: true });
    await new RedisApprovalStore({ client: noTtl.client }).save(
      buildApproval({ id: 'apr_no_ttl' }),
    );

    assert(
      noTtl.sets[0]?.mode === undefined && noTtl.sets[0]?.duration === undefined,
      'Test 8c: With neither expiresAt nor ttlSeconds the key never expires',
      JSON.stringify(noTtl.sets[0]),
    );
  } catch (err: any) {
    assert(false, 'Test 8: ttlSeconds fallback precedence', err.message);
  }

  // TEST 9: claim() prefers GETDEL and falls back correctly
  try {
    const atomic = createFakeRedis({ withGetDel: true });
    let getdelCalls = 0;
    const wrappedGetDel = atomic.client.getdel!;
    atomic.client.getdel = async (key) => {
      getdelCalls++;
      return wrappedGetDel(key);
    };

    const atomicStore = new RedisApprovalStore({ client: atomic.client });
    await atomicStore.save(buildApproval({ id: 'apr_getdel' }));
    const claimed = await atomicStore.claim('apr_getdel');

    assert(getdelCalls === 1, 'Test 9a: claim() issues a single GETDEL when available');
    assert(claimed?.id === 'apr_getdel', 'Test 9b: The GETDEL path returns the record');
    assert(
      atomic.storage.size === 0,
      'Test 9c: The GETDEL path removes the key',
      String(atomic.storage.size),
    );

    const fallback = createFakeRedis({ withGetDel: false });
    const fallbackStore = new RedisApprovalStore({ client: fallback.client });
    await fallbackStore.save(buildApproval({ id: 'apr_fallback_claim' }));

    const fallbackClaimed = await fallbackStore.claim('apr_fallback_claim');
    assert(
      fallbackClaimed?.id === 'apr_fallback_claim' && fallback.storage.size === 0,
      'Test 9d: Without GETDEL, claim() still reads then removes the record',
    );
  } catch (err: any) {
    assert(false, 'Test 9: claim() command selection', err.message);
  }

  // TEST 10: Stored payloads are plain JSON, so any Redis client can read them
  try {
    const { client, storage } = createFakeRedis({ withGetDel: true });
    const store = new RedisApprovalStore({ client });
    const expiresAt = new Date(Date.now() + 120_000);

    await store.save(buildApproval({ id: 'apr_json', expiresAt }));
    const raw = storage.get('agentic:approval:apr_json')!;
    const parsed = JSON.parse(raw);

    assert(typeof raw === 'string', 'Test 10a: The record is stored as a JSON string');
    assert(
      parsed.id === 'apr_json' && parsed.agentName === 'banker',
      'Test 10b: Stored JSON carries the identifying fields',
    );
    assert(
      typeof parsed.createdAt === 'string' && typeof parsed.expiresAt === 'string',
      'Test 10c: Dates are stored as ISO strings',
    );

    const loaded = await store.get('apr_json');
    assert(
      loaded?.createdAt instanceof Date && loaded?.expiresAt instanceof Date,
      'Test 10d: Both Date fields are revived on read',
    );
    assert(
      loaded?.expiresAt?.getTime() === expiresAt.getTime(),
      'Test 10e: The revived expiresAt matches the original instant',
    );
  } catch (err: any) {
    assert(false, 'Test 10: Stored payload shape', err.message);
  }

  console.log(`\n  📊 Step 11 Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Step 11 Unit Tests Failed');
  }
}

if (require.main === module) {
  runApprovalStoreContractTests().catch(() => process.exit(1));
}
