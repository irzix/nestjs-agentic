import type { SessionStore, SessionRecord } from '../interfaces/session.interface';

export interface SessionStoreContractOptions {
  /** Store name used in the test report. */
  name: string;
  /**
   * Builds an empty store. Called once per assertion group, so each group
   * starts from a clean state.
   */
  createStore(): SessionStore | Promise<SessionStore>;
  /** Set false to keep console output quiet. Default: true */
  log?: boolean;
}

export interface SessionStoreContractResult {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  failures: string[];
}

/**
 * Behavioral contract for a `SessionStore`.
 *
 * A compliant store persists session conversation records as serializable data,
 * isolates returned objects from internal store state, and supports multi-session
 * and tenant-scoped keys.
 *
 * @param options Configuration for running the contract suite.
 * @returns Result summary of passed and failed assertions.
 */
export async function runSessionStoreContract(
  options: SessionStoreContractOptions,
): Promise<SessionStoreContractResult> {
  const log = options.log ?? true;

  const result: SessionStoreContractResult = {
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

  if (log) {
    console.log(`\n🔧 SessionStore contract: ${options.name}\n`);
  }

  const sampleRecord: SessionRecord = {
    sessionId: 'sess_test_1',
    messages: [
      { role: 'user', content: 'Hello agent' },
      { role: 'assistant', content: 'Hello! How can I help?' },
    ],
    updatedAt: new Date().toISOString(),
  };

  // 1. Missing key
  {
    const store = await options.createStore();
    const loaded = await store.get('missing-session');
    check(loaded === null, 'get() returns null for a missing session key');
  }

  // 2. Round-trip record
  {
    const store = await options.createStore();
    await store.set('tenantA:sess_1', sampleRecord);
    const loaded = (await store.get('tenantA:sess_1')) as SessionRecord;

    check(Boolean(loaded), 'get() returns saved session record');
    check(loaded?.sessionId === sampleRecord.sessionId, 'sessionId preserved accurately');
    check(Array.isArray(loaded?.messages), 'messages array preserved');
    check(loaded?.messages.length === 2, 'message count matches saved record');
    check(loaded?.messages[0].role === 'user', 'message role preserved');
    check(loaded?.messages[0].content === 'Hello agent', 'message content preserved');
    check(loaded?.updatedAt === sampleRecord.updatedAt, 'updatedAt timestamp preserved');
  }

  // 3. Delete
  {
    const store = await options.createStore();
    await store.set('tenantA:sess_del', sampleRecord);
    await store.delete('tenantA:sess_del');
    const loaded = await store.get('tenantA:sess_del');
    check(loaded === null, 'delete() removes session record completely');
  }

  // 4. Overwrite
  {
    const store = await options.createStore();
    await store.set('tenantA:sess_overwrite', sampleRecord);

    const updatedRecord: SessionRecord = {
      sessionId: 'sess_test_1',
      messages: [
        ...sampleRecord.messages,
        { role: 'user', content: 'What is the balance?' },
      ],
      updatedAt: new Date().toISOString(),
    };

    await store.set('tenantA:sess_overwrite', updatedRecord);
    const loaded = (await store.get('tenantA:sess_overwrite')) as SessionRecord;
    check(loaded?.messages.length === 3, 'subsequent set() overwrites previous record');
  }

  // 5. Multi-session isolation
  {
    const store = await options.createStore();
    const recordA: SessionRecord = {
      sessionId: 'sess_A',
      messages: [{ role: 'user', content: 'Message A' }],
      updatedAt: new Date().toISOString(),
    };
    const recordB: SessionRecord = {
      sessionId: 'sess_B',
      messages: [{ role: 'user', content: 'Message B' }],
      updatedAt: new Date().toISOString(),
    };

    await store.set('tenant1:sess_A', recordA);
    await store.set('tenant2:sess_B', recordB);

    const loadedA = (await store.get('tenant1:sess_A')) as SessionRecord;
    const loadedB = (await store.get('tenant2:sess_B')) as SessionRecord;

    check(loadedA?.messages[0].content === 'Message A', 'tenant1 session isolated');
    check(loadedB?.messages[0].content === 'Message B', 'tenant2 session isolated');
  }

  // 6. Isolation from mutation
  {
    const store = await options.createStore();
    await store.set('tenantA:sess_mut', sampleRecord);
    const loaded1 = (await store.get('tenantA:sess_mut')) as SessionRecord;

    if (loaded1 && loaded1.messages) {
      loaded1.messages.push({ role: 'user', content: 'Injected mutation' });
    }

    const loaded2 = (await store.get('tenantA:sess_mut')) as SessionRecord;
    check(
      loaded2?.messages.length === 2,
      'modifying returned record does not mutate store state',
    );
  }

  if (log) {
    console.log(
      `\n  📊 ${options.name} contract: ${result.passed} passed, ${result.failed} failed.\n`,
    );
  }

  return result;
}
