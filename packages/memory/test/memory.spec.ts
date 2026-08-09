import { InMemoryStateStore, RedisStateStore } from '@nestjs-agentic/core';
import type { GenericRedisClient } from '@nestjs-agentic/core';
import { CompositeMemory, ScratchpadMemory, ShortTermMemory } from '../src';

export async function runMemoryTests() {
  console.log('🧠 Running @nestjs-agentic/memory Unit Tests...\n');

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

  const sessionId = 'sess_mem_1001';

  // TEST 1: ShortTermMemory Sliding Window
  try {
    const shortTerm = new ShortTermMemory({ maxMessages: 3 });
    await shortTerm.save({ id: '1', sessionId, type: 'short_term', content: 'Message 1' });
    await shortTerm.save({ id: '2', sessionId, type: 'short_term', content: 'Message 2' });
    await shortTerm.save({ id: '3', sessionId, type: 'short_term', content: 'Message 3' });
    await shortTerm.save({ id: '4', sessionId, type: 'short_term', content: 'Message 4' });

    const window = await shortTerm.getWindow(sessionId);
    assert(window.length === 3, 'Test 1a: ShortTermMemory caps history to maxMessages (3)');
    assert(window[0].content === 'Message 2', 'Test 1b: Oldest message (Message 1) pruned');
    assert(window[2].content === 'Message 4', 'Test 1c: Latest message (Message 4) present');
  } catch (err: any) {
    assert(false, 'Test 1: ShortTermMemory', err.message);
  }

  // TEST 2: ScratchpadMemory Task Set
  try {
    const scratchpad = new ScratchpadMemory();
    await scratchpad.save({
      id: 'task_1',
      sessionId,
      type: 'scratchpad',
      content: 'Refactor auth module',
      metadata: { taskId: 'task_1', status: 'in_progress' },
    });

    const tasks = await scratchpad.getWorkingSet(sessionId);
    assert(tasks.length === 1, 'Test 2a: ScratchpadMemory saved 1 working task');
    assert(tasks[0].content === 'Refactor auth module', 'Test 2b: Task content matches');
  } catch (err: any) {
    assert(false, 'Test 2: ScratchpadMemory', err.message);
  }

  // TEST 3: CompositeMemory Unified Recall
  try {
    const st = new ShortTermMemory();
    const sp = new ScratchpadMemory();
    const composite = new CompositeMemory([st, sp]);

    await composite.save({ id: 'm1', sessionId, type: 'short_term', content: 'Find bug in payment' });
    await composite.save({
      id: 'm2',
      sessionId,
      type: 'scratchpad',
      content: 'Payment gateway integration',
      metadata: { taskId: 't_payment' },
    });

    const recalled = await composite.recall('payment', { sessionId });
    assert(recalled.length === 2, 'Test 3a: CompositeMemory recalled items across all memory tiers');
  } catch (err: any) {
    assert(false, 'Test 3: CompositeMemory', err.message);
  }

  // TEST 4: Integration with Core StateStore (RedisStateStore)
  try {
    const redisStorage = new Map<string, string>();
    const mockRedisClient: GenericRedisClient = {
      async get(key: string): Promise<string | null> {
        return redisStorage.get(key) ?? null;
      },
      async set(key: string, value: string): Promise<unknown> {
        redisStorage.set(key, value);
        return 'OK';
      },
      async del(key: string): Promise<number> {
        redisStorage.delete(key);
        return 1;
      },
      async keys(pattern: string): Promise<string[]> {
        return Array.from(redisStorage.keys());
      },
    };

    const redisStateStore = new RedisStateStore({ client: mockRedisClient });
    const memory = new ShortTermMemory({ stateStore: redisStateStore });

    await memory.save({
      id: 'r_1',
      sessionId: 'sess_core_redis',
      type: 'short_term',
      content: 'User prefers core unified RedisStateStore',
    });

    const recalled = await memory.recall('core', { sessionId: 'sess_core_redis' });
    assert(recalled.length === 1, 'Test 4a: ShortTermMemory backed by core RedisStateStore saved & recalled item');
    assert(recalled[0].content.includes('unified'), 'Test 4b: Memory content retrieved from core RedisStateStore matches');
  } catch (err: any) {
    assert(false, 'Test 4: Core StateStore Integration', err.message);
  }

  console.log(`\n  📊 Memory Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Memory Unit Tests Failed');
  }
}

if (require.main === module) {
  runMemoryTests().catch(() => process.exit(1));
}
