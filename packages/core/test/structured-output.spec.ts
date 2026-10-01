import 'reflect-metadata';
import { ModuleRef } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  Agent,
  AgenticModule,
  AgentRunner,
  ApprovalService,
  ExecutionLimitExceededError,
  InMemoryApprovalStore,
  LocalToolProvider,
  MockRuntimeAdapter,
  Param,
  parseJsonAnswer,
  StructuredOutputError,
  StructuredOutputNotSupportedError,
  Tool,
  ToolDiscoveryService,
  ToolSet,
  UsePolicies,
  validateJsonSchema,
} from '../src';
import type {
  AgentConfig,
  AgentProvider,
  AgentStreamEvent,
  AgenticModuleOptions,
  JsonSchema,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  PolicyResult,
  SessionRecord,
  SessionStore,
  StructuredOutputOptions,
  ToolPolicy,
} from '../src';

const TRIAGE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    category: { enum: ['billing', 'technical', 'other'] },
    priority: { type: 'integer', minimum: 1, maximum: 5 },
    summary: { type: 'string', minLength: 1 },
  },
  required: ['category', 'priority', 'summary'],
  additionalProperties: false,
};

const VALID = '{"category":"billing","priority":2,"summary":"Charged twice"}';

/** Replays scripted responses in order and records every request. */
class ScriptedAdapter implements ModelAdapter {
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(
    private readonly responses: Array<ModelResponse | string>,
    readonly supportsStructuredOutput?: boolean,
  ) {}

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const next = this.responses[Math.min(this.index++, this.responses.length - 1)];
    const response = typeof next === 'string' ? { content: next } : next;
    return { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, ...response };
  }
}

/** Records what the runtime persists as conversation history. */
class RecordingSessionStore implements SessionStore {
  readonly writes: SessionRecord[] = [];
  private readonly data = new Map<string, unknown>();
  async get(sessionId: string) {
    return this.data.get(sessionId) ?? null;
  }
  async set(sessionId: string, data: unknown) {
    this.writes.push(data as SessionRecord);
    this.data.set(sessionId, data);
  }
  async delete(sessionId: string) {
    this.data.delete(sessionId);
  }
}

let agentSchema: JsonSchema | undefined = TRIAGE_SCHEMA;
let agentOptions: StructuredOutputOptions | undefined;

class ApproveRefunds implements ToolPolicy {
  async evaluate(): Promise<PolicyResult> {
    return { decision: 'require_approval', reason: 'Refunds need sign-off.' };
  }
}

@ToolSet({ name: 'support-desk' })
class SupportTools {
  @Tool({ name: 'lookupCustomer', description: 'Look up a customer' })
  lookupCustomer(@Param('email') email: string) {
    return { email, plan: 'pro' };
  }

  @Tool({ name: 'refund', description: 'Refund a charge' })
  @UsePolicies(ApproveRefunds)
  refund(@Param('amount', { type: 'number' }) amount: number) {
    return { refunded: amount };
  }
}

@Agent({ name: 'triage', description: 'Classifies support tickets' })
class TriageAgent implements AgentProvider {
  constructor(private readonly tools: SupportTools) {}

  define(): AgentConfig {
    return {
      instructions: 'Classify the ticket.',
      tools: [this.tools],
      outputSchema: agentSchema,
      structuredOutput: agentOptions,
    };
  }
}

async function boot(adapter: ModelAdapter, extra: Partial<AgenticModuleOptions> = {}, providers: object[] = []) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AgenticModule.forRoot({
        defaultModel: { provider: 'mock', model: 'm' },
        modelAdapter: adapter,
        ...extra,
      }),
      AgenticModule.forFeature({ agents: [TriageAgent], toolSets: [SupportTools], policies: [ApproveRefunds] }),
    ],
    providers: providers as never[],
  }).compile();
  return { runner: moduleRef.get(AgentRunner), approvals: moduleRef.get(ApprovalService) };
}

async function expectError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return err;
  }
}

export async function runStructuredOutputTests() {
  console.log('🧩 Running Structured Output (JSON Schema validation and repair) Tests...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, label: string, detail?: string) {
    if (condition) {
      passed++;
      console.log(`  ✅ PASS: ${label}`);
    } else {
      failed++;
      console.error(`  ❌ FAIL: ${label}${detail ? ` (${detail})` : ''}`);
    }
  }

  const reset = () => {
    agentSchema = TRIAGE_SCHEMA;
    agentOptions = undefined;
  };

  // TEST 1: the built-in validator
  try {
    const ok = validateJsonSchema(JSON.parse(VALID), TRIAGE_SCHEMA);
    assert(ok.valid && ok.issues.length === 0, 'Test 1a: A conforming value validates');

    const bad = validateJsonSchema({ category: 'sales', priority: 7.5, extra: true }, TRIAGE_SCHEMA);
    assert(
      bad.issues.includes('$.category: must be one of ["billing","technical","other"]') &&
        bad.issues.includes('$.priority: expected integer, received number') &&
        bad.issues.includes('$.summary: is required') &&
        bad.issues.includes('$.extra: is not an allowed property'),
      'Test 1b: Issues name the JSON path and the rule broken',
      JSON.stringify(bad.issues),
    );

    const refSchema: JsonSchema = {
      type: 'object',
      properties: { items: { type: 'array', items: { $ref: '#/$defs/line' }, minItems: 1 } },
      $defs: { line: { type: 'object', properties: { sku: { type: 'string', pattern: '^SKU-' }, qty: { type: 'number', exclusiveMinimum: 0 } }, required: ['sku', 'qty'] } },
    };
    const refResult = validateJsonSchema({ items: [{ sku: 'SKU-1', qty: 1 }, { sku: 'X', qty: 0 }] }, refSchema);
    assert(
      JSON.stringify(refResult.issues) === JSON.stringify(['$.items[1].sku: must match pattern "^SKU-"', '$.items[1].qty: must be > 0']),
      'Test 1c: Local $refs, array items, pattern, and exclusive bounds',
      JSON.stringify(refResult.issues),
    );

    const unions: JsonSchema = {
      type: 'object',
      properties: {
        id: { type: ['string', 'null'] },
        value: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
        tag: { anyOf: [{ const: 'a' }, { const: 'b' }] },
        notZero: { not: { const: 0 } },
      },
    };
    assert(validateJsonSchema({ id: null, value: 3, tag: 'b', notZero: 1 }, unions).valid, 'Test 1d: Type unions, oneOf, anyOf, and not accept matches');
    const unionIssues = validateJsonSchema({ id: 1, value: 1.5, tag: 'c', notZero: 0 }, unions).issues;
    assert(unionIssues.length === 4, 'Test 1e: …and reject each mismatch', JSON.stringify(unionIssues));
    assert(validateJsonSchema({}, { not: true } as JsonSchema).valid === false, 'Test 1f: Boolean subschemas are honored');
    assert(
      validateJsonSchema(Array.from({ length: 50 }, () => 'x'), { type: 'array', items: { type: 'number' } }).issues.length === 20,
      'Test 1g: Issues are capped so a repair prompt stays bounded',
    );
  } catch (err) {
    assert(false, 'Test 1: Validator', String(err));
  }

  // TEST 2: answer parsing tolerates common wrappers
  try {
    const fenced = parseJsonAnswer('Here you go:\n```json\n{"a":1}\n```');
    const prose = parseJsonAnswer('The result is {"a":2}. Hope that helps!');
    const broken = parseJsonAnswer('{"a":');
    assert(fenced.ok && (fenced.value as { a: number }).a === 1, 'Test 2a: A fenced code block is parsed');
    assert(prose.ok && (prose.value as { a: number }).a === 2, 'Test 2b: A JSON object inside prose is parsed');
    assert(!broken.ok && broken.issue.startsWith('$: the answer is not valid JSON'), 'Test 2c: Invalid JSON yields an issue');
  } catch (err) {
    assert(false, 'Test 2: Parsing', String(err));
  }

  // TEST 3: a conforming answer is parsed onto the result
  try {
    reset();
    const adapter = new ScriptedAdapter([VALID]);
    const { runner } = await boot(adapter);
    const result = await runner.run<{ category: string; priority: number }>('triage', {
      sessionId: 's3',
      message: 'I was charged twice',
    });
    assert(result.structured?.category === 'billing' && result.structured.priority === 2, 'Test 3a: result.structured holds the parsed value');
    assert(result.output === VALID, 'Test 3b: result.output keeps the raw text');
    const format = adapter.requests[0].outputFormat;
    assert(
      format?.type === 'json_schema' && format.name === 'response' && format.strict === false && format.schema === TRIAGE_SCHEMA,
      'Test 3c: The request carries the outputFormat with default name and non-strict mode',
      JSON.stringify(format),
    );
    const system = adapter.requests[0].messages[0];
    assert(
      system.role === 'system' && system.content.startsWith('Classify the ticket.') && system.content.includes('"additionalProperties":false'),
      'Test 3d: Without native support the schema is described in the system prompt',
    );

    const native = new ScriptedAdapter([VALID], true);
    await (await boot(native)).runner.run('triage', { sessionId: 's3b', message: 'hi' });
    assert(
      native.requests[0].messages[0].content === 'Classify the ticket.',
      'Test 3e: With native support the prompt is left alone',
      native.requests[0].messages[0].content,
    );
  } catch (err) {
    assert(false, 'Test 3: Conforming answer', String(err));
  }

  // TEST 4: a non-conforming answer is repaired, and the repair is not persisted
  try {
    reset();
    const sessions = new RecordingSessionStore();
    const adapter = new ScriptedAdapter(['{"category":"sales","priority":2}', `\`\`\`json\n${VALID}\n\`\`\``]);
    const { runner } = await boot(adapter, { sessionStore: sessions });
    const result = await runner.run('triage', { sessionId: 's4', message: 'charged twice' });

    assert(adapter.requests.length === 2, 'Test 4a: One repair round was made', String(adapter.requests.length));
    const repairPrompt = adapter.requests[1].messages[adapter.requests[1].messages.length - 1];
    assert(
      repairPrompt.role === 'user' &&
        repairPrompt.content.includes('$.category: must be one of') &&
        repairPrompt.content.includes('$.summary: is required'),
      'Test 4b: The repair prompt lists the specific issues',
      repairPrompt.content,
    );
    assert(
      adapter.requests[1].messages[adapter.requests[1].messages.length - 2].content === '{"category":"sales","priority":2}',
      'Test 4c: The model sees its rejected answer before the repair prompt',
    );
    assert((result.structured as { category?: string })?.category === 'billing', 'Test 4d: The repaired answer is returned');
    assert(result.usage?.totalTokens === 30, 'Test 4e: Repair rounds count toward usage', String(result.usage?.totalTokens));

    const history = sessions.writes[sessions.writes.length - 1]?.messages ?? [];
    assert(
      history.length === 2 && history[0].role === 'user' && history[1].role === 'assistant' && !history.some((m) => m.content.includes('did not match')),
      'Test 4f: Session history keeps the question and the conforming answer, not the repair exchange',
      JSON.stringify(history.map((m) => m.role)),
    );
  } catch (err) {
    assert(false, 'Test 4: Repair', String(err));
  }

  // TEST 5: repair is bounded
  try {
    reset();
    const sessions = new RecordingSessionStore();
    const adapter = new ScriptedAdapter(['not json at all']);
    const { runner } = await boot(adapter, { sessionStore: sessions });
    const err = await expectError(runner.run('triage', { sessionId: 's5', message: 'x' }));
    assert(
      err instanceof StructuredOutputError && err.attempts === 2 && err.output === 'not json at all' && err.issues[0].includes('not valid JSON'),
      'Test 5a: After the default 2 repairs the turn fails with StructuredOutputError',
      String(err),
    );
    assert(adapter.requests.length === 3, 'Test 5b: One answer plus two repairs were requested', String(adapter.requests.length));
    assert(sessions.writes.length === 0, 'Test 5c: A failed turn persists no history');

    agentOptions = { maxRepairAttempts: 0 };
    const once = new ScriptedAdapter(['nope']);
    const noRepair = await expectError((await boot(once)).runner.run('triage', { sessionId: 's5b', message: 'x' }));
    assert(noRepair instanceof StructuredOutputError && once.requests.length === 1, 'Test 5d: maxRepairAttempts 0 disables repair');

    agentOptions = { maxRepairAttempts: 10 };
    const budget = await expectError(
      (await boot(new ScriptedAdapter(['nope']))).runner.run('triage', { sessionId: 's5c', message: 'x', limits: { maxIterations: 3 } }),
    );
    assert(budget instanceof ExecutionLimitExceededError, 'Test 5e: Repair rounds are bounded by maxIterations');
  } catch (err) {
    assert(false, 'Test 5: Bounded repair', String(err));
  }

  // TEST 6: per-run overrides and a custom validator
  try {
    reset();
    const runSchema: JsonSchema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
    const adapter = new ScriptedAdapter(['{"ok":true}']);
    const result = await (await boot(adapter)).runner.run('triage', {
      sessionId: 's6',
      message: 'x',
      outputSchema: runSchema,
      structuredOutput: { name: 'health', strict: true },
    });
    assert(
      (result.structured as { ok?: boolean })?.ok === true &&
        adapter.requests[0].outputFormat?.schema === runSchema &&
        adapter.requests[0].outputFormat?.name === 'health' &&
        adapter.requests[0].outputFormat?.strict === true,
      'Test 6a: A run-level outputSchema and options override the agent',
    );

    agentOptions = {
      validate: (value) =>
        typeof (value as { priority?: unknown }).priority === 'number'
          ? { valid: true, value: { ...(value as object), normalized: true } }
          : { valid: false, issues: ['$.priority: custom rule'] },
    };
    const custom = new ScriptedAdapter(['{"priority":"high"}', '{"priority":3}']);
    const customResult = await (await boot(custom)).runner.run('triage', { sessionId: 's6b', message: 'x' });
    assert(
      (customResult.structured as { normalized?: boolean })?.normalized === true &&
        custom.requests[1].messages.some((m) => m.content.includes('$.priority: custom rule')),
      'Test 6b: A custom validator replaces the built-in one and can transform the value',
    );

    agentSchema = undefined;
    agentOptions = { maxRepairAttempts: 1 };
    const none = await (await boot(new ScriptedAdapter(['free text']))).runner.run('triage', { sessionId: 's6c', message: 'x' });
    assert(none.structured === undefined && none.output === 'free text', 'Test 6c: Options without a schema change nothing');
  } catch (err) {
    assert(false, 'Test 6: Overrides', String(err));
  }

  // TEST 7: tools still work, including when the model answers a repair prompt with a tool call
  try {
    reset();
    const sessions = new RecordingSessionStore();
    const adapter = new ScriptedAdapter([
      { content: '', toolCalls: [{ id: 'c1', name: 'lookupCustomer', args: { email: 'a@b.c' } }] },
      'Sure, it is billing.',
      { content: '', toolCalls: [{ id: 'c2', name: 'lookupCustomer', args: { email: 'a@b.c' } }] },
      VALID,
    ]);
    const result = await (await boot(adapter, { sessionStore: sessions })).runner.run('triage', { sessionId: 's7', message: 'x' });
    assert(result.toolCalls.length === 2 && (result.structured as { category?: string })?.category === 'billing', 'Test 7a: Tool rounds and repair compose');
    const history = sessions.writes[sessions.writes.length - 1]?.messages ?? [];
    assert(
      history.some((m) => m.role === 'user' && m.content.includes('did not match')) &&
        history.findIndex((m) => m.content.includes('did not match')) <
          history.findIndex((m) => m.role === 'assistant' && m.toolCalls?.[0]?.id === 'c2'),
      'Test 7b: A repair answered with tool calls is committed to history, in order',
      JSON.stringify(history.map((m) => m.role)),
    );
  } catch (err) {
    assert(false, 'Test 7: Tools and repair', String(err));
  }

  // TEST 8: streaming reports rejected answers and the structured result
  try {
    reset();
    const adapter = new ScriptedAdapter(['{"category":1}', VALID]);
    const events: AgentStreamEvent[] = [];
    for await (const event of (await boot(adapter)).runner.runStream('triage', { sessionId: 's8', message: 'x' })) {
      events.push(event);
    }
    const rejected = events.find((e) => e.type === 'output_rejected');
    const final = events.find((e) => e.type === 'final_answer');
    assert(
      rejected?.type === 'output_rejected' && rejected.attempt === 1 && rejected.issues.some((i) => i.startsWith('$.category')),
      'Test 8a: output_rejected tells stream consumers to discard the previous answer',
      JSON.stringify(rejected),
    );
    assert(
      final?.type === 'final_answer' && (final.structured as { category?: string })?.category === 'billing',
      'Test 8b: final_answer carries the structured value',
    );
    assert(
      events.findIndex((e) => e.type === 'output_rejected') < events.findIndex((e) => e.type === 'final_answer'),
      'Test 8c: The rejection precedes the final answer',
    );
  } catch (err) {
    assert(false, 'Test 8: Streaming', String(err));
  }

  // TEST 9: a suspended turn is validated when it resumes
  try {
    reset();
    const adapter = new ScriptedAdapter([
      { content: '', toolCalls: [{ id: 'r1', name: 'refund', args: { amount: 20 } }] },
      VALID,
    ]);
    const { runner, approvals } = await boot(adapter);
    const suspended = await runner.run('triage', { sessionId: 's9', message: 'refund me' });
    const approvalId = (suspended.toolCalls[0]?.result as { approvalId?: string })?.approvalId;
    assert(suspended.structured === undefined && Boolean(approvalId), 'Test 9a: A suspended turn has no structured value yet');
    const resumed = (await approvals.approve(approvalId!)) as { structured?: { category?: string } };
    assert(resumed.structured?.category === 'billing', 'Test 9b: The resumed turn is validated against the agent schema');
  } catch (err) {
    assert(false, 'Test 9: Approval resume', String(err));
  }

  // TEST 10: a RuntimeAdapter cannot honor a schema, so the run fails loudly
  try {
    reset();
    const moduleRef = { get: () => undefined } as unknown as ModuleRef;
    const runner = new AgentRunner(
      [new TriageAgent(new SupportTools())],
      new MockRuntimeAdapter(),
      { defaultModel: { provider: 'mock', model: 'm' } },
      new LocalToolProvider([], new InMemoryApprovalStore(), new ToolDiscoveryService(), moduleRef),
      moduleRef,
    );
    const err = await expectError(runner.run('triage', { sessionId: 's10', message: 'x' }));
    assert(err instanceof StructuredOutputNotSupportedError, 'Test 10: A RuntimeAdapter turn with an outputSchema throws', String(err));
  } catch (err) {
    assert(false, 'Test 10: RuntimeAdapter', String(err));
  }

  reset();
  console.log(`\n  📊 Structured Output Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Structured output tests failed');
  }
}
