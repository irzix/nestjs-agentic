import 'reflect-metadata';
import { Global, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  Agent,
  AgenticModule,
  AgentRunner,
  Context,
  MockModelAdapter,
  Param,
  SESSION_STORE,
  Tool,
  ToolSet,
  trimHistory,
} from '../src';
import type {
  AgentConfig,
  AgentContext,
  AgentProvider,
  ModelMessage,
  SessionRecord,
  SessionStore,
} from '../src';

/** Records every read and write so the test can assert on the stored shape. */
class RecordingSessionStore implements SessionStore {
  readonly store = new Map<string, unknown>();
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  failNextRead = false;

  async get(sessionId: string): Promise<unknown | null> {
    this.reads.push(sessionId);
    if (this.failNextRead) {
      this.failNextRead = false;
      throw new Error('session store unavailable');
    }
    return this.store.get(sessionId) ?? null;
  }

  async set(sessionId: string, data: unknown): Promise<void> {
    this.writes.push(sessionId);
    this.store.set(sessionId, data);
  }

  async delete(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
  }

  record(sessionId: string): SessionRecord | undefined {
    return this.store.get(sessionId) as SessionRecord | undefined;
  }
}

@Injectable()
class NoteService {
  readonly notes: string[] = [];
}

@Global()
@Module({ providers: [NoteService], exports: [NoteService] })
class NoteModule {}

@ToolSet({ name: 'notes' })
class NoteTools {
  constructor(private readonly notes: NoteService) {}

  @Tool({ name: 'saveNote', description: 'Save a note' })
  async saveNote(
    @Param('text', { required: true }) text: string,
    @Context() _ctx: AgentContext,
  ) {
    this.notes.notes.push(text);
    return { saved: true, text };
  }
}

@Agent({ name: 'assistant', description: 'Keeps notes' })
class AssistantAgent implements AgentProvider {
  constructor(private readonly tools: NoteTools) {}

  define(): AgentConfig {
    return { instructions: 'Be brief.', tools: [this.tools] };
  }
}

export async function runConversationHistoryTests() {
  console.log('💬 Running Step 10: Conversation History Tests...\n');

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

  async function bootstrap(model: MockModelAdapter, store: SessionStore, maxMessages?: number) {
    return Test.createTestingModule({
      imports: [
        NoteModule,
        AgenticModule.forRoot({
          defaultModel: { provider: 'mock', model: 'deterministic' },
          modelAdapter: model,
          sessionStore: store,
          ...(maxMessages !== undefined ? { session: { maxMessages } } : {}),
        }),
        AgenticModule.forFeature({ agents: [AssistantAgent], toolSets: [NoteTools] }),
      ],
    }).compile();
  }

  // TEST 1: A second turn sees the first
  try {
    const model = new MockModelAdapter();
    model.whenAsked('My name is Sara').reply('Nice to meet you, Sara.');
    model.whenAsked('What is my name?').reply('Sara.');

    const store = new RecordingSessionStore();
    const moduleRef = await bootstrap(model, store);
    const runner = moduleRef.get(AgentRunner, { strict: false });

    await runner.run('assistant', { sessionId: 's1', message: 'My name is Sara' });
    const second = await runner.run('assistant', { sessionId: 's1', message: 'What is my name?' });

    const record = store.record('s1');
    assert(Boolean(record), 'Test 1a: Conversation persisted after the first turn');
    assert(
      Boolean(record?.messages.some((m) => m.role === 'user' && m.content === 'My name is Sara')),
      'Test 1b: User message stored',
    );
    assert(
      Boolean(
        record?.messages.some(
          (m) => m.role === 'assistant' && m.content === 'Nice to meet you, Sara.',
        ),
      ),
      'Test 1c: Assistant answer stored',
    );
    assert(
      !record?.messages.some((m) => m.role === 'system'),
      'Test 1d: Instructions not stored, since they are reapplied each turn',
    );
    assert(second.output === 'Sara.', 'Test 1e: Second turn ran with replayed history');
    assert(store.reads.length === 2 && store.writes.length === 2, 'Test 1f: One read and one write per turn');
  } catch (err: any) {
    assert(false, 'Test 1: Multi-turn conversation', err.message);
  }

  // TEST 2: History is scoped per tenant
  try {
    const model = new MockModelAdapter();
    model.whenAsked('remember this').reply('ok');

    const store = new RecordingSessionStore();
    const moduleRef = await bootstrap(model, store);
    const runner = moduleRef.get(AgentRunner, { strict: false });

    await runner.run('assistant', {
      sessionId: 'shared',
      message: 'remember this',
      context: { tenantId: 'acme' },
    });
    await runner.run('assistant', {
      sessionId: 'shared',
      message: 'remember this',
      context: { tenantId: 'globex' },
    });

    assert(Boolean(store.record('acme:shared')), 'Test 2a: Tenant included in the storage key');
    assert(
      Boolean(store.record('globex:shared')),
      'Test 2b: A second tenant gets an independent transcript',
    );
    assert(
      !store.store.has('shared'),
      'Test 2c: Tenant-scoped sessions never collide on the bare session id',
    );
  } catch (err: any) {
    assert(false, 'Test 2: Tenant scoping', err.message);
  }

  // TEST 3: Tool exchanges are replayed in a provider-safe order
  try {
    const model = new MockModelAdapter();
    model.whenAsked('save hello').callTool('saveNote', { text: 'hello' }).reply('Saved.');
    model.whenAsked('what did I save?').reply('hello');

    const store = new RecordingSessionStore();
    const moduleRef = await bootstrap(model, store);
    const runner = moduleRef.get(AgentRunner, { strict: false });

    await runner.run('assistant', { sessionId: 's3', message: 'save hello' });
    const record = store.record('s3');

    const assistantWithCalls = record?.messages.find(
      (m) => m.role === 'assistant' && Boolean(m.toolCalls?.length),
    );
    const toolMessage = record?.messages.find((m) => m.role === 'tool');

    assert(Boolean(assistantWithCalls), 'Test 3a: Assistant tool call stored');
    assert(Boolean(toolMessage), 'Test 3b: Tool result stored');
    assert(
      record!.messages.indexOf(assistantWithCalls!) < record!.messages.indexOf(toolMessage!),
      'Test 3c: Tool result follows the request that produced it',
    );

    const second = await runner.run('assistant', { sessionId: 's3', message: 'what did I save?' });
    assert(second.output === 'hello', 'Test 3d: Replaying a tool exchange does not break the turn');
  } catch (err: any) {
    assert(false, 'Test 3: Tool exchange replay', err.message);
  }

  // TEST 4: history: false keeps a turn stateless
  try {
    const model = new MockModelAdapter();
    model.whenAsked('one off').reply('done');

    const store = new RecordingSessionStore();
    const moduleRef = await bootstrap(model, store);
    const runner = moduleRef.get(AgentRunner, { strict: false });

    await runner.run('assistant', { sessionId: 's4', message: 'one off', history: false });

    assert(store.reads.length === 0, 'Test 4a: No history read for a stateless turn');
    assert(store.writes.length === 0, 'Test 4b: No history written for a stateless turn');
  } catch (err: any) {
    assert(false, 'Test 4: Stateless opt-out', err.message);
  }

  // TEST 5: A failing store never breaks the run
  try {
    const model = new MockModelAdapter();
    model.whenAsked('still works').reply('yes');

    const store = new RecordingSessionStore();
    store.failNextRead = true;
    const moduleRef = await bootstrap(model, store);
    const runner = moduleRef.get(AgentRunner, { strict: false });

    const result = await runner.run('assistant', { sessionId: 's5', message: 'still works' });
    assert(result.output === 'yes', 'Test 5a: Turn completes when the history read fails');
  } catch (err: any) {
    assert(false, 'Test 5: Store failure tolerance', err.message);
  }

  // TEST 6: Retention cap drops the oldest messages
  try {
    const model = new MockModelAdapter();
    model.whenAsked('a').reply('1');
    model.whenAsked('b').reply('2');
    model.whenAsked('c').reply('3');

    const store = new RecordingSessionStore();
    const moduleRef = await bootstrap(model, store, 2);
    const runner = moduleRef.get(AgentRunner, { strict: false });

    await runner.run('assistant', { sessionId: 's6', message: 'a' });
    await runner.run('assistant', { sessionId: 's6', message: 'b' });
    await runner.run('assistant', { sessionId: 's6', message: 'c' });

    const record = store.record('s6');
    assert(record?.messages.length === 2, 'Test 6a: Retention cap enforced', String(record?.messages.length));
    assert(
      record?.messages[record.messages.length - 1].content === '3',
      'Test 6b: Most recent messages retained',
    );
  } catch (err: any) {
    assert(false, 'Test 6: Retention', err.message);
  }

  // TEST 7: Trimming never leaves an orphan tool exchange
  try {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'first' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'saveNote', args: { text: 'x' } }],
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'saveNote', content: '{}' },
      { role: 'assistant', content: 'done' },
    ];

    const trimmed = trimHistory(messages, 2);
    assert(
      trimmed[0]?.role !== 'tool',
      'Test 7a: History never starts with an orphan tool result',
      trimmed[0]?.role,
    );

    const cut = trimHistory(messages, 3);
    assert(
      cut.every((m) => !(m.role === 'assistant' && m.toolCalls?.length) || cut.some((t) => t.role === 'tool')),
      'Test 7b: A retained tool request keeps its result',
    );
    assert(trimHistory(messages, 0).length === 0, 'Test 7c: A zero cap yields no history');
  } catch (err: any) {
    assert(false, 'Test 7: Trim safety', err.message);
  }

  console.log(`\n  📊 Step 10 Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Step 10 Unit Tests Failed');
  }
}

if (require.main === module) {
  runConversationHistoryTests().catch(() => process.exit(1));
}
