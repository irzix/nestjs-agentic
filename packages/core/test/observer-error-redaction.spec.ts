import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  Agent,
  AgenticModule,
  AgentRunner,
  createErrorRedactor,
  defaultErrorRedactor,
  ObserverNotifier,
  Param,
  RedactedError,
  Tool,
  ToolSet,
} from '../src';
import type {
  AgentConfig,
  AgentErrorEvent,
  ErrorRedactor,
  AgentObserver,
  AgentProvider,
  AgenticModuleOptions,
  CircuitBreakerEvent,
  ModelAdapter,
  ModelRetryEvent,
} from '../src';

const OPENAI_KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
const BEARER = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.c2lnbmF0dXJl';
const COOKIE_VALUE = 'session=s3cr3tSessionValue; csrftoken=anotherSecret';
const CAUSE_TOKEN = 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BODY_SECRET = 'prompt-content-the-user-typed';

/**
 * Shaped like a provider SDK error: request config with headers, a response
 * body, non-enumerable and symbol-keyed fields, and a nested `cause` chain.
 */
function syntheticProviderError(): Error {
  const root = new Error(`connect ECONNRESET while using Authorization: ${BEARER}`);
  root.name = 'FetchError';
  (root as Error & { code?: string }).code = 'ECONNRESET';

  const middle = new Error(`upstream rejected token=${CAUSE_TOKEN}`);
  (middle as Error & { cause?: unknown }).cause = root;

  const err = new Error(`401 Incorrect API key provided: ${OPENAI_KEY}. Cookie: ${COOKIE_VALUE}`);
  err.name = 'AuthenticationError';
  Object.assign(err, {
    status: 401,
    request: { url: 'https://api.example.com/v1/chat', headers: { Authorization: BEARER, 'x-api-key': OPENAI_KEY } },
    response: { data: { messages: [{ role: 'user', content: BODY_SECRET }] } },
  });
  Object.defineProperty(err, 'config', { value: { apiKey: OPENAI_KEY }, enumerable: false });
  (err as unknown as Record<symbol, unknown>)[Symbol('vendor')] = { secret: OPENAI_KEY };
  (err as Error & { cause?: unknown }).cause = middle;
  return err;
}

/** Every string reachable from `value`, own properties and symbols included. */
function allText(value: unknown, seen = new Set<unknown>()): string {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null || seen.has(value)) return '';
  seen.add(value);
  return Reflect.ownKeys(value)
    .map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && 'value' in descriptor ? allText(descriptor.value, seen) : '';
    })
    .join('\n');
}

const SECRETS = [OPENAI_KEY, 'eyJhbGciOiJIUzI1NiJ9', 's3cr3tSessionValue', 'anotherSecret', CAUSE_TOKEN, BODY_SECRET];

@ToolSet({ name: 'noop' })
class NoopToolSet {
  @Tool({ name: 'noop', description: 'Does nothing' })
  noop(@Param('x') x: string) {
    return { x };
  }

  @Tool({ name: 'explode', description: 'Fails like an HTTP client would' })
  explode() {
    throw new Error(`request failed with Authorization: Bearer ${OPENAI_KEY}`);
  }
}

@Agent({ name: 'RedactionAgent', description: 'Fails on demand' })
class RedactionAgent implements AgentProvider {
  constructor(private readonly tools: NoopToolSet) {}

  define(): AgentConfig {
    return { instructions: 'Answer.', tools: [this.tools] };
  }
}

async function runAgainst(
  adapter: ModelAdapter,
  observer: AgentObserver,
  extra: Partial<AgenticModuleOptions> = {},
): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AgenticModule.forRoot({
        defaultModel: { provider: 'openai', model: 'gpt-4o' },
        modelAdapter: adapter,
        observers: [observer],
        ...extra,
      }),
      AgenticModule.forFeature({ agents: [RedactionAgent], toolSets: [NoopToolSet] }),
    ],
  }).compile();
  try {
    await moduleRef.get(AgentRunner).run('RedactionAgent', { sessionId: 'redaction', message: 'hi' });
  } catch {
    // The turn is expected to fail; the assertions are about what observers saw.
  }
}

export async function runObserverErrorRedactionTests() {
  console.log('🧪 Starting Observer Error Redaction Test Suite...');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, label: string, detail?: string): void {
    if (condition) {
      passed++;
      console.log(`  ✅ PASS: ${label}`);
    } else {
      failed++;
      console.error(`  ❌ FAIL: ${label}${detail ? ` (${detail})` : ''}`);
    }
  }

  // TEST 1: onError receives a scrubbed error by default
  try {
    const errors: AgentErrorEvent[] = [];
    await runAgainst(
      {
        async generate() {
          throw syntheticProviderError();
        },
      },
      { onError: (event) => void errors.push(event) },
    );

    const error = errors[0]?.error as RedactedError | undefined;
    const text = allText(error);
    assert(errors.length === 1, 'Test 1a: onError fired once');
    assert(error instanceof RedactedError, 'Test 1b: Observers receive a RedactedError');
    assert(
      SECRETS.every((secret) => !text.includes(secret)),
      'Test 1c: No secret survives anywhere on the error, cause chain included',
      SECRETS.filter((secret) => text.includes(secret)).join(', '),
    );
    assert(error?.name === 'AuthenticationError' && error?.status === 401, 'Test 1d: name and status are kept');
    assert(
      Boolean(error?.message.startsWith('401 Incorrect API key provided: [REDACTED]')),
      'Test 1e: The message keeps its diagnostic text around the mask',
      error?.message,
    );
    assert(
      Boolean(error?.message.includes('Cookie: [REDACTED]')),
      'Test 1f: Every cookie pair is masked, not only the first',
      error?.message,
    );
    const record = error as unknown as Record<string, unknown>;
    assert(
      record.request === undefined && record.response === undefined && record.config === undefined,
      'Test 1g: Request config, response body, and non-enumerable fields are dropped',
    );
    assert(Object.getOwnPropertySymbols(error ?? {}).length === 0, 'Test 1h: Symbol-keyed fields are dropped');
    assert(
      error?.cause?.message === 'upstream rejected token=[REDACTED]' &&
        error?.cause?.cause?.name === 'FetchError' &&
        error?.cause?.cause?.code === 'ECONNRESET' &&
        error?.cause?.cause?.message === 'connect ECONNRESET while using Authorization: [REDACTED]',
      'Test 1i: The cause chain is walked and redacted link by link',
      JSON.stringify([error?.cause?.message, error?.cause?.cause?.message]),
    );
    assert(
      Boolean(error?.stack?.startsWith('AuthenticationError: 401 Incorrect API key provided: [REDACTED]')) &&
        Boolean(error?.stack?.includes('\n    at ')),
      'Test 1j: The stack keeps its frames under a redacted header',
    );
  } catch (err: unknown) {
    assert(false, 'Test 1: onError redaction', (err as Error).message);
  }

  // TEST 2: onModelRetry receives a scrubbed error
  try {
    const retries: ModelRetryEvent[] = [];
    let calls = 0;
    await runAgainst(
      {
        async generate() {
          calls++;
          const err = new Error(`503 overloaded, api_key=${OPENAI_KEY}`);
          Object.assign(err, { status: 503, headers: { authorization: BEARER } });
          throw err;
        },
      },
      { onModelRetry: (event) => void retries.push(event) },
      { resilience: { retry: { maxAttempts: 2, initialDelayMs: 1, jitter: 0 } } },
    );

    const error = retries[0]?.error as RedactedError | undefined;
    assert(calls === 2 && retries.length === 1, 'Test 2a: The failed attempt was retried once', `calls ${calls}`);
    assert(
      error instanceof RedactedError && error.message === '503 overloaded, api_key=[REDACTED]' && error.status === 503,
      'Test 2b: The retry event carries the redacted error',
      error?.message,
    );
    assert(!allText(error).includes(BEARER), 'Test 2c: Headers on the retried error are dropped');
  } catch (err: unknown) {
    assert(false, 'Test 2: onModelRetry redaction', (err as Error).message);
  }

  // TEST 3: the circuit-breaker reason, which embeds the error message, is scrubbed
  try {
    const transitions: CircuitBreakerEvent[] = [];
    const notifier = new ObserverNotifier([{ onCircuitStateChange: (event) => void transitions.push(event) }]);
    await notifier.notifyCircuitStateChange({
      circuitName: 'model',
      from: 'closed',
      to: 'open',
      failures: 5,
      reason: `5 consecutive failures: Incorrect API key provided: ${OPENAI_KEY}`,
      timestamp: new Date(),
    });
    assert(
      transitions[0]?.reason === '5 consecutive failures: Incorrect API key provided: [REDACTED]',
      'Test 3: CircuitBreakerEvent.reason is redacted',
      transitions[0]?.reason,
    );
  } catch (err: unknown) {
    assert(false, 'Test 3: Circuit reason redaction', (err as Error).message);
  }

  // TEST 4: 'none' is an explicit opt-out that delivers the original error
  try {
    const errors: AgentErrorEvent[] = [];
    const original = syntheticProviderError();
    await runAgainst(
      {
        async generate() {
          throw original;
        },
      },
      { onError: (event) => void errors.push(event) },
      { observability: { errorRedaction: 'none' } },
    );
    assert(errors[0]?.error === original, 'Test 4: errorRedaction "none" passes the raw error through');
  } catch (err: unknown) {
    assert(false, 'Test 4: Opt-out', (err as Error).message);
  }

  // TEST 5: a custom redactor replaces the default
  try {
    const errors: AgentErrorEvent[] = [];
    await runAgainst(
      {
        async generate() {
          throw syntheticProviderError();
        },
      },
      { onError: (event) => void errors.push(event) },
      { observability: { errorRedaction: (err) => new Error(`custom:${(err as Error).name}`) } },
    );
    assert(errors[0]?.error.message === 'custom:AuthenticationError', 'Test 5: The configured redactor is used');
  } catch (err: unknown) {
    assert(false, 'Test 5: Custom redactor', (err as Error).message);
  }

  // TEST 6: a redactor that throws fails closed
  try {
    const errors: AgentErrorEvent[] = [];
    const notifier = new ObserverNotifier([{ onError: (event) => void errors.push(event) }], {
      errorRedaction: () => {
        throw new Error('boom');
      },
    });
    await notifier.notifyError({
      agentName: 'a',
      sessionId: 's',
      traceId: 't',
      error: syntheticProviderError(),
      durationMs: 1,
      timestamp: new Date(),
    });
    assert(
      errors[0]?.error.message === '[error redaction failed]' && !allText(errors[0]?.error).includes(OPENAI_KEY),
      'Test 6: A throwing redactor yields a placeholder, never the raw error',
    );
  } catch (err: unknown) {
    assert(false, 'Test 6: Throwing redactor', (err as Error).message);
  }

  // TEST 7: default redactor edge cases
  try {
    const long = defaultErrorRedactor(new Error(`${'x'.repeat(600)} ${OPENAI_KEY}`));
    assert(
      long.message.length < 520 && long.message.endsWith('…[truncated]'),
      'Test 7a: Messages are length-capped',
      String(long.message.length),
    );

    const straddle = defaultErrorRedactor(new Error(`${'x'.repeat(490)} ${OPENAI_KEY}`));
    assert(!straddle.message.includes('sk-proj-ab'), 'Test 7b: A secret straddling the cut is masked, not half-kept');

    const loop = new Error('loop') as Error & { cause?: unknown };
    loop.cause = loop;
    const cyclic = defaultErrorRedactor(loop) as RedactedError;
    assert(cyclic.message === 'loop' && cyclic.cause === undefined, 'Test 7c: A cyclic cause chain terminates');

    let deep: Error & { cause?: unknown } = new Error('level 0');
    for (let level = 1; level <= 10; level++) {
      const next = new Error(`level ${level}`) as Error & { cause?: unknown };
      next.cause = deep;
      deep = next;
    }
    let depth = 0;
    for (let node: RedactedError | undefined = defaultErrorRedactor(deep) as RedactedError; node?.cause; node = node.cause) {
      depth++;
    }
    assert(depth === 3, 'Test 7d: Cause chains stop at the default depth of 3', String(depth));

    const thrownString = defaultErrorRedactor(`failed with password=${OPENAI_KEY}`);
    assert(
      thrownString instanceof RedactedError && thrownString.message === 'failed with password=[REDACTED]',
      'Test 7e: A thrown string becomes a redacted Error',
      thrownString.message,
    );

    const thrownObject = defaultErrorRedactor({ statusCode: 429, message: 'slow down', headers: { 'x-api-key': OPENAI_KEY } });
    assert(
      (thrownObject as RedactedError).statusCode === 429 && !allText(thrownObject).includes(OPENAI_KEY),
      'Test 7f: A thrown plain object keeps statusCode and drops headers',
    );

    const url = defaultErrorRedactor(new Error('connect to postgres://admin:hunter2@db.internal:5432 failed'));
    assert(
      url.message === 'connect to postgres://[REDACTED]@db.internal:5432 failed',
      'Test 7g: URL credentials are masked and the host is kept',
      url.message,
    );

    const json = defaultErrorRedactor(new Error('{"error":"bad","api_key":"abc123def456","model":"gpt-4o"}'));
    assert(
      json.message === '{"error":"bad","api_key":"[REDACTED]","model":"gpt-4o"}',
      'Test 7h: JSON-embedded keys are masked in place',
      json.message,
    );

    const hostile = new Proxy(new Error('x'), {
      get() {
        throw new Error('trap');
      },
    });
    const fromProxy = defaultErrorRedactor(hostile);
    assert(fromProxy instanceof RedactedError, 'Test 7i: Throwing getters do not escape the redactor');

    const tuned = createErrorRedactor({ maxMessageLength: 10, maxCauseDepth: 0, patterns: [/internal-\d+/] });
    const tunedOut = tuned(Object.assign(new Error('internal-42 broke'), { cause: new Error('inner') })) as RedactedError;
    assert(
      tunedOut.message === '[REDACTED]…[truncated]' && tunedOut.cause === undefined,
      'Test 7j: createErrorRedactor honors length, depth, and custom patterns',
      tunedOut.message,
    );

    const keepsBenign = defaultErrorRedactor(new Error('max_tokens=4096 exceeds the 8192 tokens context window'));
    assert(
      keepsBenign.message === 'max_tokens=4096 exceeds the 8192 tokens context window',
      'Test 7k: Benign token counts are not mistaken for credentials',
      keepsBenign.message,
    );
  } catch (err: unknown) {
    assert(false, 'Test 7: Default redactor edge cases', (err as Error).message);
  }

  // TEST 8: credential shapes found in review
  try {
    const shapes: Array<[string, string]> = [
      ['DB_PASSWORD=hunter2 OPENAI_API_KEY=abc123xyz GITHUB_TOKEN=tok', 'DB_PASSWORD=[REDACTED] OPENAI_API_KEY=[REDACTED] GITHUB_TOKEN=[REDACTED]'],
      ['{"db_password":"hunter2","aws_secret_access_key":"wJalrXUtnFEMI"}', '{"db_password":"[REDACTED]","aws_secret_access_key":"[REDACTED]"}'],
      ['private_key: abc123', 'private_key: [REDACTED]'],
      ['https://a.blob.core.windows.net/c?sv=2021&sig=abc%2Bdef&se=2026', 'https://a.blob.core.windows.net/c?sv=2021&sig=[REDACTED]&se=2026'],
      ['postgres://admin:ab/cd+ef@db.host:5432/app', 'postgres://[REDACTED]@db.host:5432/app'],
      ['postgres://admin:p@ss@db.host', 'postgres://[REDACTED]@db.host'],
      ['header bearer abcdefghijklmnop', 'header bearer [REDACTED]'],
      ['password = "correct horse battery"', 'password = "[REDACTED]"'],
      ['{\\"api_key\\":\\"abcdefgh12345\\"}', '{\\"api_key\\":\\"[REDACTED]\\"}'],
    ];
    for (const [input, expected] of shapes) {
      const out = defaultErrorRedactor(new Error(input)).message;
      assert(out === expected, `Test 8: ${input.slice(0, 40)} is masked`, out);
    }
  } catch (err: unknown) {
    assert(false, 'Test 8: Credential shapes', (err as Error).message);
  }

  // TEST 9: truncation and stack frames cannot be used to get around the cap
  try {
    const token = `ghp_${'A'.repeat(36)}`;
    const straddle = `cookie: ${'x'.repeat(1890)}\nend ${'y'.repeat(100 - token.length / 2)}${token} tail`;
    const cut = defaultErrorRedactor(new Error(straddle)).message;
    assert(!cut.includes('ghp_A'), 'Test 9a: A shrinking mask cannot pull a partial secret into the kept text', cut.slice(-60));

    const quoted = Array.from({ length: 40 }, (_, i) => `    at remote${i} prompt: confidential user text ${i}`).join('\n');
    const embedded = defaultErrorRedactor(new Error(`upstream failed\n${quoted}`));
    assert(
      !(embedded.stack ?? '').includes('remote10') && (embedded.stack ?? '').length < 6000,
      'Test 9b: Message lines that look like frames are not kept as frames',
      String((embedded.stack ?? '').length),
    );

    const deep = new Error('boom');
    deep.stack = `Error: boom\n    at ${'Very'.repeat(100)}.method (/app/node_modules/pkg/dist/file.js:123:45)`;
    const tuned = createErrorRedactor({ maxMessageLength: 0 })(deep);
    const frameLine = (tuned.stack ?? '').split('\n')[1] ?? '';
    assert(
      frameLine.endsWith('file.js:123:45)') && frameLine.length <= 301,
      'Test 9c: Long frames keep their location, and frames do not follow maxMessageLength',
      frameLine,
    );

    const withNullCause = Object.assign(new Error('x'), { cause: null });
    assert((defaultErrorRedactor(withNullCause) as RedactedError).cause === undefined, 'Test 9d: cause: null is not turned into a fake cause');
  } catch (err: unknown) {
    assert(false, 'Test 9: Truncation and frames', (err as Error).message);
  }

  // TEST 10: failed tool results carry error text too
  try {
    const results: unknown[] = [];
    const ends: unknown[] = [];
    await runAgainst(
      {
        async generate(request) {
          const answered = request.messages.some((m) => m.role === 'tool');
          return answered
            ? { content: 'done' }
            : { content: '', toolCalls: [{ id: 'c1', name: 'explode', args: {} }] };
        },
      },
      {
        onToolResult: (event) => void results.push(event.result),
        onAgentEnd: (event) => void ends.push(event.result.toolCalls[0]?.result),
      },
    );
    assert(
      JSON.stringify(results[0]).includes('Authorization: [REDACTED]') && !JSON.stringify(results[0]).includes('sk-proj'),
      'Test 10a: onToolResult receives a redacted tool error',
      JSON.stringify(results[0]),
    );
    assert(!JSON.stringify(ends[0]).includes('sk-proj'), 'Test 10b: onAgentEnd tool calls are redacted too', JSON.stringify(ends[0]));
  } catch (err: unknown) {
    assert(false, 'Test 10: Tool failures', (err as Error).message);
  }

  // TEST 11: misbehaving redactors and configuration
  try {
    const reasons: string[] = [];
    const sloppy = new ObserverNotifier([{ onCircuitStateChange: (event) => void reasons.push(event.reason) }], {
      errorRedaction: (() => undefined) as unknown as ErrorRedactor,
    });
    let threw = false;
    try {
      await sloppy.notifyCircuitStateChange({ circuitName: 'm', from: 'closed', to: 'open', failures: 5, reason: OPENAI_KEY, timestamp: new Date() });
    } catch {
      threw = true;
    }
    assert(!threw && reasons[0] === '[error redaction failed]', 'Test 11a: A redactor returning nothing cannot crash the circuit breaker path');

    const customText = new ObserverNotifier([{ onCircuitStateChange: (event) => void reasons.push(event.reason) }], {
      errorRedaction: Object.assign(() => new Error('x'), { redactText: (text: string) => text.replace(/\d+/, 'N') }),
    });
    await customText.notifyCircuitStateChange({ circuitName: 'm', from: 'closed', to: 'open', failures: 5, reason: '5 consecutive failures', timestamp: new Date() });
    assert(reasons[1] === 'N consecutive failures', 'Test 11b: A custom redactText decides the reason text', reasons[1]);

    for (const bad of [false, 'off', 0]) {
      let rejected = false;
      try {
        new ObserverNotifier([], { errorRedaction: bad as unknown as ErrorRedactor });
      } catch {
        rejected = true;
      }
      assert(rejected, `Test 11c: errorRedaction ${JSON.stringify(bad)} is rejected instead of failing open`);
    }

    let calls = 0;
    const counting = new ObserverNotifier([{ onAgentStart: () => undefined }], {
      errorRedaction: (err) => {
        calls++;
        return err as Error;
      },
    });
    await counting.notifyError({ agentName: 'a', sessionId: 's', traceId: 't', error: new Error('x'), durationMs: 1, timestamp: new Date() });
    assert(calls === 0, 'Test 11d: Nothing is redacted when no observer has the hook');

    const sticky = createErrorRedactor({ patterns: [/foo/y] })(new Error('xx foo foo')).message;
    assert(sticky === 'xx [REDACTED] [REDACTED]', 'Test 11e: Sticky custom patterns match anywhere', sticky);
  } catch (err: unknown) {
    assert(false, 'Test 11: Redactor robustness', (err as Error).message);
  }

  console.log(`\n  📊 Observer Error Redaction Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Observer error redaction tests failed');
  }
}
