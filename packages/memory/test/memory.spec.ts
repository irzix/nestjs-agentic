import { InMemoryStateStore, RedisStateStore } from '@nestjs-agentic/core';
import type { GenericRedisClient } from '@nestjs-agentic/core';
import {
  CompositeMemory,
  EpisodicMemory,
  ScratchpadMemory,
  SemanticMemory,
  ShortTermMemory,
  TokenBudgetSummarizer,
} from '../src';

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

  // TEST 5: SemanticMemory Basic Search
  try {
    const semantic = new SemanticMemory();
    await semantic.save({
      id: 'sem_1',
      sessionId,
      type: 'semantic',
      content: 'User is allergic to peanuts and prefers dark mode UI',
    });
    await semantic.save({
      id: 'sem_2',
      sessionId,
      type: 'semantic',
      content: 'User account billing cycle is monthly on 1st',
    });

    const matches = await semantic.recall('allergic peanuts', { sessionId });
    assert(matches.length === 1, 'Test 5a: SemanticMemory recalled relevant record');
    assert(matches[0].content.includes('peanuts'), 'Test 5b: Recalled semantic record content matches query');
  } catch (err: any) {
    assert(false, 'Test 5: SemanticMemory', err.message);
  }

  // TEST 6: EpisodicMemory Timeline
  try {
    const episodic = new EpisodicMemory();
    await episodic.save({
      id: 'ep_1',
      sessionId,
      type: 'episodic',
      content: 'Agent initialized financial transfer workflow',
    });

    const timeline = await episodic.getTimeline(sessionId);
    assert(timeline.length === 1, 'Test 6a: EpisodicMemory recorded trajectory event');
    assert(timeline[0].content.includes('financial transfer'), 'Test 6b: Timeline content matches');
  } catch (err: any) {
    assert(false, 'Test 6: EpisodicMemory', err.message);
  }

  // TEST 7: TokenBudgetSummarizer
  try {
    const summarizer = new TokenBudgetSummarizer({ maxTokenBudget: 20 });
    const records = [
      { id: '1', sessionId, type: 'short_term', content: 'Long interaction sentence line 1' },
      { id: '2', sessionId, type: 'short_term', content: 'Long interaction sentence line 2' },
      { id: '3', sessionId, type: 'short_term', content: 'Long interaction sentence line 3' },
      { id: '4', sessionId, type: 'short_term', content: 'Recent question' },
    ];

    const summarized = summarizer.summarizeRecords(records);
    assert(summarized.length < records.length, 'Test 7a: TokenBudgetSummarizer compressed records');
    assert(summarized[0].content.includes('Summary of'), 'Test 7b: Summary record created');
  } catch (err: any) {
    assert(false, 'Test 7: TokenBudgetSummarizer', err.message);
  }

  console.log(`\n  📊 Memory Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Memory Unit Tests Failed');
  }
}

if (require.main === module) {
  runMemoryTests().catch(() => process.exit(1));
}
