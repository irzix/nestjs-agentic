import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  Agent,
  AgenticModule,
  AgentRunner,
  Context,
  DeferredWriteQueue,
  MockModelAdapter,
  ObserverNotifier,
  Param,
  Tool,
  ToolSet,
} from '../src';
import type {
  AgentConfig,
  AgentContext,
  AgentObserver,
  AgentProvider,
  AgenticModuleOptions,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  ModelStreamChunk,
  SessionStore,
  StateStore,
} from '../src';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A store whose writes take time, so a test can see whether a turn waited for them. */
class SlowStore implements StateStore, SessionStore {
  readonly data = new Map<string, unknown>();
  readonly writeOrder: string[] = [];
  /** Whether a record existed for the key at the moment of each read. */
  readonly readsSawRecord: boolean[] = [];
  inFlight = 0;
  failWrites = false;

  constructor(private readonly writeDelayMs: number) {}

  async get<T = unknown>(key: string): Promise<T | null> {
    this.readsSawRecord.push(this.data.has(key));
    return (this.data.get(key) as T | undefined) ?? null;
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    this.inFlight++;
    try {
      await sleep(this.writeDelayMs);
      if (this.failWrites) {
        throw new Error('store unavailable');
      }
      this.data.set(key, value);
      this.writeOrder.push(key);
    } finally {
      this.inFlight--;
    }
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

/** Wraps the mock model and notes how many store writes were pending at each round. */
class ProbingModel implements ModelAdapter {
  readonly pendingAtRound: number[] = [];

  constructor(
    private readonly inner: MockModelAdapter,
    private readonly stores: SlowStore[],
  ) {}

  private note(): void {
    this.pendingAtRound.push(this.stores.reduce((sum, s) => sum + s.inFlight, 0));
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.note();
    return this.inner.generate(request);
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.note();
    yield* this.inner.stream(request);
  }
}

@ToolSet({ name: 'calendar' })
class CalendarTools {
  @Tool({ name: 'checkSlot', description: 'Check a calendar slot' })
  async checkSlot(@Param('day', { required: true }) day: string, @Context() _ctx: AgentContext) {
    return { free: true, day };
  }
}

@Agent({ name: 'receptionist', description: 'Books appointments' })
class ReceptionistAgent implements AgentProvider {
  constructor(private readonly tools: CalendarTools) {}

  define(): AgentConfig {
    return { instructions: 'Be brief.', tools: [this.tools] };
  }
}

export async function runDurabilityTests() {
  console.log('⏱️  Running Durability & Observer Timeout Tests...\n');

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

  function scriptedModel(): MockModelAdapter {
    const model = new MockModelAdapter();
    model.whenAsked('Is Monday free?').callTool('checkSlot', { day: 'Monday' }).reply('Yes, Monday is free.');
    model.whenAsked('Book it').reply('Booked.');
    return model;
  }

  async function bootstrap(
    model: ModelAdapter,
    stores: { state: SlowStore; session: SlowStore },
    extra: Partial<AgenticModuleOptions> = {},
  ) {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AgenticModule.forRoot({
          defaultModel: { provider: 'mock', model: 'deterministic' },
          modelAdapter: model,
          stateStore: stores.state,
          sessionStore: stores.session,
          ...extra,
        }),
        AgenticModule.forFeature({ agents: [ReceptionistAgent], toolSets: [CalendarTools] }),
      ],
    }).compile();
    return moduleRef.get(AgentRunner, { strict: false });
  }

  // TEST 1: Default sync durability waits for the checkpoint before the next round
  try {
    const stores = { state: new SlowStore(30), session: new SlowStore(30) };
    const model = new ProbingModel(scriptedModel(), [stores.state, stores.session]);
    const runner = await bootstrap(model, stores);

    const result = await runner.run('receptionist', { sessionId: 'call_1', message: 'Is Monday free?' });
    assert(result.output === 'Yes, Monday is free.', 'Test 1a: Turn completes with the scripted answer');
    assert(model.pendingAtRound.length === 2, 'Test 1b: Tool turn runs two model rounds', `got ${model.pendingAtRound.length}`);
    assert(model.pendingAtRound[1] === 0, 'Test 1c: Sync mode starts round two with no write pending', `got ${model.pendingAtRound[1]}`);
  } catch (err: unknown) {
    assert(false, 'Test 1: Sync durability', (err as Error).message);
  }

  // TEST 2: Async durability starts the next round while the checkpoint is still being written
  try {
    const stores = { state: new SlowStore(30), session: new SlowStore(30) };
    const model = new ProbingModel(scriptedModel(), [stores.state, stores.session]);
    const runner = await bootstrap(model, stores, { durability: 'async' });

    const result = await runner.run('receptionist', { sessionId: 'call_2', message: 'Is Monday free?' });
    assert(result.output === 'Yes, Monday is free.', 'Test 2a: Turn completes with the scripted answer');
    assert(model.pendingAtRound[1] > 0, 'Test 2b: Round two starts while the checkpoint write is pending', `got ${model.pendingAtRound[1]}`);
    assert(stores.state.inFlight === 0 && stores.session.inFlight === 0, 'Test 2c: Every queued write finished before run() resolved');
    assert(stores.session.data.has('call_2'), 'Test 2d: History persisted by the end of the turn');
    assert(stores.state.data.has('checkpoint:latest:call_2'), 'Test 2e: Latest checkpoint persisted by the end of the turn');
  } catch (err: unknown) {
    assert(false, 'Test 2: Async durability', (err as Error).message);
  }

  // TEST 3: A run can override the module setting
  try {
    const stores = { state: new SlowStore(30), session: new SlowStore(30) };
    const model = new ProbingModel(scriptedModel(), [stores.state, stores.session]);
    const runner = await bootstrap(model, stores, { durability: 'async' });

    await runner.run('receptionist', { sessionId: 'call_3', message: 'Is Monday free?', durability: 'sync' });
    assert(model.pendingAtRound[1] === 0, 'Test 3a: Run-level sync overrides module async', `got ${model.pendingAtRound[1]}`);
  } catch (err: unknown) {
    assert(false, 'Test 3: Per-run override', (err as Error).message);
  }

  // TEST 4: A failed queued write fails the turn once the queue drains
  try {
    const stores = { state: new SlowStore(5), session: new SlowStore(5) };
    stores.session.failWrites = true;
    const runner = await bootstrap(scriptedModel(), stores, { durability: 'async' });

    let error: Error | undefined;
    try {
      await runner.run('receptionist', { sessionId: 'call_4', message: 'Book it' });
    } catch (err: unknown) {
      error = err as Error;
    }
    assert(error?.message === 'store unavailable', 'Test 4a: History write failure surfaces from run()', error?.message);

    stores.session.failWrites = false;
    const retry = await runner.run('receptionist', { sessionId: 'call_4', message: 'Book it' });
    assert(retry.output === 'Booked.', 'Test 4b: The next turn is unaffected by the earlier failure');
  } catch (err: unknown) {
    assert(false, 'Test 4: Async write failure', (err as Error).message);
  }

  // TEST 5: A stream consumer that stops early still gives the next turn its history
  try {
    const stores = { state: new SlowStore(5), session: new SlowStore(40) };
    const runner = await bootstrap(scriptedModel(), stores, { durability: 'async' });

    for await (const event of runner.runStream('receptionist', { sessionId: 'call_5', message: 'Is Monday free?' })) {
      if (event.type === 'final_answer') {
        break;
      }
    }
    const savedAtBreak = stores.session.data.has('call_5');
    await runner.run('receptionist', { sessionId: 'call_5', message: 'Book it' });

    assert(!savedAtBreak, 'Test 5a: History was not yet saved when the consumer stopped');
    assert(stores.session.readsSawRecord[stores.session.readsSawRecord.length - 1] === true, 'Test 5b: Next turn read history only after the pending write landed');
  } catch (err: unknown) {
    assert(false, 'Test 5: Early stream exit', (err as Error).message);
  }

  // TEST 6: Streamed async turns drain the queue before completing
  try {
    const stores = { state: new SlowStore(20), session: new SlowStore(20) };
    const model = new ProbingModel(scriptedModel(), [stores.state, stores.session]);
    const runner = await bootstrap(model, stores, { durability: 'async' });

    const types: string[] = [];
    for await (const event of runner.runStream('receptionist', { sessionId: 'call_6', message: 'Is Monday free?' })) {
      types.push(event.type);
    }
    assert(types.includes('final_answer'), 'Test 6a: Stream emits the final answer');
    assert(model.pendingAtRound[1] > 0, 'Test 6b: Streamed round two does not wait for the checkpoint');
    assert(stores.session.data.has('call_6') && stores.session.inFlight === 0, 'Test 6c: History persisted once the stream is exhausted');
  } catch (err: unknown) {
    assert(false, 'Test 6: Async streaming', (err as Error).message);
  }

  // TEST 7: DeferredWriteQueue keeps order and reports the first failure
  try {
    const order: number[] = [];
    const queue = new DeferredWriteQueue();
    queue.enqueue(async () => {
      await sleep(20);
      order.push(1);
    });
    queue.enqueue(() => {
      throw new Error('first');
    });
    queue.enqueue(async () => {
      order.push(3);
    });
    queue.enqueue(() => {
      throw new Error('second');
    });

    await queue.settled;
    assert(order.join(',') === '1,3', 'Test 7a: Writes run in order and continue past a failure', order.join(','));

    let flushed: Error | undefined;
    try {
      await queue.flush();
    } catch (err: unknown) {
      flushed = err as Error;
    }
    assert(flushed?.message === 'first', 'Test 7b: flush() rethrows the first failure', flushed?.message);

    let again: Error | undefined;
    try {
      await queue.flush();
    } catch (err: unknown) {
      again = err as Error;
    }
    assert(again === undefined, 'Test 7c: A reported failure is not rethrown twice');

    const after = new DeferredWriteQueue(Promise.reject(new Error('earlier turn')));
    const ran: string[] = [];
    after.enqueue(() => {
      ran.push('x');
    });
    await after.flush();
    assert(ran.length === 1, 'Test 7d: A rejected predecessor does not block or fail the queue');
  } catch (err: unknown) {
    assert(false, 'Test 7: DeferredWriteQueue', (err as Error).message);
  }

  // TEST 8: ObserverNotifier timeout bounds how long a hook waits
  try {
    let finished = 0;
    const slow: AgentObserver = {
      async onModelRequest() {
        await sleep(200);
        finished++;
      },
    };
    const event = { agentName: 'a', sessionId: 's', traceId: 't', iteration: 0, messages: [], timestamp: new Date() } as never;

    let start = Date.now();
    await new ObserverNotifier([slow]).notifyModelRequest(event);
    const unbounded = Date.now() - start;

    start = Date.now();
    await new ObserverNotifier([slow], { timeoutMs: 20 }).notifyModelRequest(event);
    const bounded = Date.now() - start;

    start = Date.now();
    await new ObserverNotifier([slow], { timeoutMs: 0 }).notifyModelRequest(event);
    const immediate = Date.now() - start;

    assert(unbounded >= 190, 'Test 8a: Unset timeout waits for the observer', `${unbounded}ms`);
    assert(bounded < 150, 'Test 8b: timeoutMs caps the wait', `${bounded}ms`);
    assert(immediate < 15, 'Test 8c: timeoutMs 0 does not wait', `${immediate}ms`);

    await sleep(250);
    assert(finished === 3, 'Test 8d: Observers still run to completion in the background', `finished ${finished}`);

    let rejected = false;
    try {
      new ObserverNotifier([slow], { timeoutMs: -5 });
    } catch {
      rejected = true;
    }
    assert(rejected, 'Test 8e: Negative timeoutMs is rejected');
  } catch (err: unknown) {
    assert(false, 'Test 8: Observer timeout', (err as Error).message);
  }

  // TEST 9: observerTimeoutMs keeps a slow observer off the turn's critical path
  try {
    let calls = 0;
    const slowObserver: AgentObserver = {
      async onModelRequest() {
        await sleep(150);
        calls++;
      },
    };
    const stores = { state: new SlowStore(0), session: new SlowStore(0) };

    const bounded = await bootstrap(scriptedModel(), stores, { observers: [slowObserver], observerTimeoutMs: 10 });
    let start = Date.now();
    await bounded.run('receptionist', { sessionId: 'call_9a', message: 'Is Monday free?' });
    const boundedMs = Date.now() - start;

    const unbounded = await bootstrap(scriptedModel(), stores, { observers: [slowObserver] });
    start = Date.now();
    await unbounded.run('receptionist', { sessionId: 'call_9b', message: 'Is Monday free?' });
    const unboundedMs = Date.now() - start;

    assert(unboundedMs >= 290, 'Test 9a: Without a timeout both rounds wait for the observer', `${unboundedMs}ms`);
    assert(boundedMs < 150, 'Test 9b: With observerTimeoutMs the turn does not wait', `${boundedMs}ms`);
    await sleep(200);
    assert(calls === 4, 'Test 9c: The observer still saw every model request', `calls ${calls}`);
  } catch (err: unknown) {
    assert(false, 'Test 9: Module observer timeout', (err as Error).message);
  }

  console.log(`\n  📊 Durability Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Durability tests failed');
  }
}
