import 'reflect-metadata';
import {
  InMemorySessionStore,
  RedisSessionStore,
  runSessionStoreContract,
} from '../src';
import type { GenericRedisClient, SessionRecord } from '../src';

/** Recorded `set` call, used to assert TTL handling. */
interface RecordedSet {
  key: string;
  value: string;
  mode?: string;
  duration?: number;
}

/** In-process Redis mock for testing RedisSessionStore. */
function createFakeRedis() {
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

  return { client, storage, sets };
}

export async function runSessionStoreContractTests() {
  console.log('🧪 Running SessionStore Contract and Unit Tests...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      passed++;
      console.log(`  ✅ PASS: ${name}`);
    } else {
      failed++;
      console.error(`  ❌ FAIL: ${name} ${detail ? `(${detail})` : ''}`);
    }
  }

  // 1. InMemorySessionStore contract compliance
  {
    const result = await runSessionStoreContract({
      name: 'InMemorySessionStore',
      createStore: () => new InMemorySessionStore(),
    });
    assert(
      result.failed === 0,
      'Test 1: InMemorySessionStore satisfies SessionStore contract',
    );
  }

  // 2. RedisSessionStore contract compliance
  {
    const { client } = createFakeRedis();
    const result = await runSessionStoreContract({
      name: 'RedisSessionStore',
      createStore: () => new RedisSessionStore({ client }),
    });
    assert(
      result.failed === 0,
      'Test 2: RedisSessionStore satisfies SessionStore contract',
    );
  }

  // 3. Custom key prefix
  try {
    const { client, storage } = createFakeRedis();
    const store = new RedisSessionStore({
      client,
      keyPrefix: 'custom:sess:',
    });

    const record: SessionRecord = {
      sessionId: 'sess_custom_key',
      messages: [{ role: 'user', content: 'Custom prefix test' }],
      updatedAt: new Date().toISOString(),
    };

    await store.set('tenant123:sess_custom_key', record);

    assert(
      storage.has('custom:sess:tenant123:sess_custom_key'),
      'Test 3a: Custom key prefix is applied to stored Redis key',
    );

    const loaded = (await store.get('tenant123:sess_custom_key')) as SessionRecord;
    assert(
      loaded?.sessionId === 'sess_custom_key',
      'Test 3b: Stored session retrieved through custom prefix',
    );
  } catch (err: any) {
    assert(false, 'Test 3: Custom key prefix', err.message);
  }

  // 4. TTL handling
  try {
    const { client, sets } = createFakeRedis();
    const store = new RedisSessionStore({
      client,
      ttlSeconds: 3600,
    });

    const record: SessionRecord = {
      sessionId: 'sess_ttl',
      messages: [{ role: 'user', content: 'TTL test' }],
      updatedAt: new Date().toISOString(),
    };

    await store.set('sess_ttl', record);

    assert(
      sets.length === 1 && sets[0].mode === 'EX' && sets[0].duration === 3600,
      'Test 4: Configured ttlSeconds is applied with EX mode on set',
    );
  } catch (err: any) {
    assert(false, 'Test 4: TTL handling', err.message);
  }

  // 5. Plain JSON storage
  try {
    const { client, storage } = createFakeRedis();
    const store = new RedisSessionStore({ client });

    const record: SessionRecord = {
      sessionId: 'sess_json',
      messages: [{ role: 'user', content: 'JSON test' }],
      updatedAt: '2026-08-14T12:00:00.000Z',
    };

    await store.set('sess_json', record);
    const raw = storage.get('agentic:session:sess_json');

    assert(typeof raw === 'string', 'Test 5a: Stored raw value is a JSON string');
    const parsed = JSON.parse(raw!);
    assert(
      parsed.sessionId === 'sess_json' && parsed.messages[0].content === 'JSON test',
      'Test 5b: Stored JSON matches serialized session record',
    );
  } catch (err: any) {
    assert(false, 'Test 5: Plain JSON storage', err.message);
  }

  console.log(`\n  📊 SessionStore Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('SessionStore Contract Tests Failed');
  }
}

if (require.main === module) {
  runSessionStoreContractTests().catch(() => process.exit(1));
}
