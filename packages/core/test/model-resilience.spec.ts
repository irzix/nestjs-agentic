import {
  AgenticError,
  CircuitBreaker,
  CircuitOpenError,
  ResilientModelAdapter,
  isRetryableModelError,
  readRetryAfterMs,
  retryWithBackoff,
} from '../src';
import type {
  CircuitStateChangeEvent,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  ModelStreamChunk,
  RetryAttemptEvent,
} from '../src';

const err = (status: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { status, ...extra });

const request: ModelRequest = {
  model: { model: 'test-model' },
  messages: [{ role: 'user', content: 'hi' }],
  tools: [],
  metadata: { sessionId: 's', traceId: 't', executionId: 'e', iteration: 0 },
};

const response = (content: string): ModelResponse => ({ content, toolCalls: [] });

/** Adapter failing `failures` times before succeeding, with an attempt counter. */
function flakyAdapter(failures: number, error: () => Error = () => err(503)) {
  let calls = 0;
  return {
    calls: () => calls,
    adapter: {
      async generate() {
        calls += 1;
        if (calls <= failures) throw error();
        return response('ok');
      },
    } satisfies ModelAdapter,
  };
}

/** Runs a retry that fails `failures` times, recording the delays it slept. */
async function recordDelays(
  failures: number,
  options: Parameters<typeof retryWithBackoff>[1] = {},
  error: () => Error = () => err(503),
) {
  const delays: number[] = [];
  const flaky = flakyAdapter(failures, error);
  let thrown: unknown;
  try {
    await retryWithBackoff(() => flaky.adapter.generate(), {
      jitter: 0,
      sleep: async (ms) => void delays.push(ms),
      ...options,
    });
  } catch (caught) {
    thrown = caught;
  }
  return { delays, thrown, calls: flaky.calls() };
}

/** Drives a breaker to failure `times` times, swallowing the rejections. */
async function trip(breaker: CircuitBreaker, times: number) {
  for (let i = 0; i < times; i++) {
    await breaker
      .execute(async () => {
        throw err(503);
      })
      .catch(() => undefined);
  }
}

export async function runModelResilienceTests() {
  console.log('\n🛡️  Model Call Resilience (Retry + Circuit Breaker) Tests\n');
  let passed = 0;
  let failed = 0;
  let n = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    n += 1;
    if (condition) {
      console.log(`  ✅ PASS: Test ${n}: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: Test ${n}: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // ---------------------------------------------------------------- retryability

  const retryable: [string, unknown, boolean][] = [
    ['503 is retryable', err(503), true],
    ['429 is retryable', err(429), true],
    ['400 is not retryable', err(400), false],
    ['401 is not retryable', err(401), false],
    ['AgenticError is never retried', new AgenticError('bad config'), false],
    ['AbortError is never retried', Object.assign(new Error('x'), { name: 'AbortError' }), false],
    ['statusCode is read as well as status', { statusCode: 502 }, true],
    ['ECONNRESET is retryable', Object.assign(new Error('reset'), { code: 'ECONNRESET' }), true],
    ['ETIMEDOUT is retryable', Object.assign(new Error('t/o'), { code: 'ETIMEDOUT' }), true],
    ['SDK connection errors are retryable by name', { name: 'APIConnectionError' }, true],
    [
      'undici fetch failures are retryable through their cause',
      Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
      }),
      true,
    ],
    ['a bare status-less error is not retried', new Error('something went wrong'), false],
    ['a programming error is not retried', new TypeError('x is not a function'), false],
  ];
  for (const [name, input, expected] of retryable) {
    assert(isRetryableModelError(input) === expected, name);
  }

  // ------------------------------------------------------------- Retry-After hint

  const hints: [string, unknown, number | undefined][] = [
    ['reads retryAfterMs', { retryAfterMs: 1500 }, 1500],
    ['reads retryAfterSeconds', { retryAfterSeconds: 2 }, 2000],
    ['reads string retryAfter header', { retryAfter: '3' }, 3000],
    ['reads numeric retryAfter header', { retryAfter: 4 }, 4000],
    ['no hint returns undefined', new Error('none'), undefined],
    ['non-finite hint is ignored', { retryAfterMs: Number.NaN }, undefined],
  ];
  for (const [name, input, expected] of hints) {
    assert(readRetryAfterMs(input) === expected, name, String(readRetryAfterMs(input)));
  }

  // --------------------------------------------------------------- retry behavior

  {
    const { delays, calls } = await recordDelays(2, { maxAttempts: 3, initialDelayMs: 100 });
    assert(calls === 3, 'succeeds after transient failures, attempting exactly 3 times', `${calls}`);
    assert(
      delays.join() === '100,200',
      'backoff doubles between attempts',
      JSON.stringify(delays),
    );
  }

  {
    const { thrown, calls } = await recordDelays(99, { maxAttempts: 3, initialDelayMs: 1 });
    assert(
      (thrown as { status?: number }).status === 503 && calls === 3,
      'rethrows the last error after exhausting attempts',
      `calls=${calls}`,
    );
  }

  {
    const { calls } = await recordDelays(99, { maxAttempts: 5 }, () => err(400));
    assert(calls === 1, 'a non-retryable error fails on the first attempt', `calls=${calls}`);
  }

  {
    const { delays } = await recordDelays(99, { maxAttempts: 2, initialDelayMs: 50 }, () =>
      err(429, { retryAfterMs: 4321 }),
    );
    assert(delays[0] === 4321, 'provider Retry-After overrides computed backoff', `${delays[0]}`);
  }

  {
    const { delays } = await recordDelays(99, { maxAttempts: 2, maxDelayMs: 5_000 }, () =>
      err(429, { retryAfterMs: 900_000 }),
    );
    assert(delays[0] === 5_000, 'Retry-After is capped by maxDelayMs', `${delays[0]}`);
  }

  {
    const { delays } = await recordDelays(99, {
      maxAttempts: 4,
      initialDelayMs: 8_000,
      maxDelayMs: 10_000,
    });
    assert(
      delays.every((d) => d <= 10_000),
      'computed backoff is capped by maxDelayMs',
      JSON.stringify(delays),
    );
  }

  {
    const observed = new Set<number>();
    for (let i = 0; i < 25; i++) {
      const { delays } = await recordDelays(1, {
        maxAttempts: 2,
        initialDelayMs: 1000,
        jitter: 0.5,
      });
      observed.add(delays[0]);
    }
    const values = [...observed];
    assert(
      values.every((d) => d >= 500 && d <= 1000),
      'jitter keeps delays within [0.5x, 1x] of the computed backoff',
      JSON.stringify(values.slice(0, 3)),
    );
    assert(observed.size > 1, 'jitter spreads delays across callers', `distinct=${observed.size}`);
  }

  {
    const retries: RetryAttemptEvent[] = [];
    await recordDelays(1, {
      maxAttempts: 2,
      initialDelayMs: 10,
      onRetry: (event) => void retries.push(event),
    });
    assert(
      retries.length === 1 && retries[0].attempt === 1 && retries[0].maxAttempts === 2,
      'onRetry reports the failed attempt number and the budget',
    );
  }

  for (const [name, options] of [
    ['maxAttempts', { maxAttempts: 0 }],
    ['jitter', { jitter: 1.5 }],
    ['initialDelayMs', { initialDelayMs: -1 }],
    ['maxDelayMs', { maxDelayMs: Number.NaN }],
  ] as const) {
    let threw = false;
    await retryWithBackoff(async () => 'ok', options).catch((e) => {
      threw = e instanceof TypeError;
    });
    assert(threw, `rejects an out-of-range ${name}`);
  }

  {
    const hookErrors = await recordDelays(1, {
      maxAttempts: 2,
      initialDelayMs: 1,
      onRetry: () => {
        throw new Error('telemetry exploded');
      },
    });
    assert(
      hookErrors.thrown === undefined && hookErrors.calls === 2,
      'an onRetry hook that throws does not abort the retry',
      `calls=${hookErrors.calls}`,
    );
  }

  {
    const controller = new AbortController();
    const flaky = flakyAdapter(99);
    let sleptFor = 0;
    const outcome = await retryWithBackoff(() => flaky.adapter.generate(), {
      maxAttempts: 5,
      initialDelayMs: 10_000,
      jitter: 0,
      signal: controller.signal,
      sleep: async (ms, signal) => {
        sleptFor = ms;
        controller.abort();
        if (signal?.aborted) return;
      },
    }).catch((e: unknown) => e);

    assert(
      outcome instanceof Error && flaky.calls() === 1 && sleptFor === 10_000,
      'aborting during backoff stops further attempts',
      `calls=${flaky.calls()}`,
    );
  }

  {
    const controller = new AbortController();
    controller.abort();
    const flaky = flakyAdapter(0);
    const outcome = await retryWithBackoff(() => flaky.adapter.generate(), {
      signal: controller.signal,
    }).catch((e: unknown) => e);

    assert(
      (outcome as Error).name === 'AbortError' && flaky.calls() === 0,
      'a pre-aborted signal dispatches nothing',
      `calls=${flaky.calls()}`,
    );
  }

  {
    const start = Date.now();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await retryWithBackoff(
      (() => {
        let calls = 0;
        return async () => {
          calls += 1;
          if (calls === 1) throw err(503);
          return 'ok';
        };
      })(),
      { maxAttempts: 2, initialDelayMs: 5_000, jitter: 0, signal: controller.signal },
    ).catch(() => undefined);

    assert(
      Date.now() - start < 1_000,
      'the default sleep observes the abort signal instead of waiting out the delay',
      `${Date.now() - start}ms`,
    );
  }

  // -------------------------------------------------------------- circuit breaker

  {
    const events: CircuitStateChangeEvent[] = [];
    const breaker = new CircuitBreaker('provider', {
      failureThreshold: 3,
      onStateChange: (e) => void events.push(e),
    });

    assert(breaker.currentState() === 'closed', 'starts closed');
    await trip(breaker, 2);
    assert(breaker.currentState() === 'closed', 'stays closed below the threshold');
    await trip(breaker, 1);
    assert(breaker.currentState() === 'open', 'opens at the failure threshold');
    assert(
      events.length === 1 && events[0].from === 'closed' && events[0].to === 'open',
      'emits the closed -> open transition once',
    );
  }

  {
    const breaker = new CircuitBreaker('provider', { failureThreshold: 1, cooldownMs: 60_000 });
    await trip(breaker, 1);

    let dispatched = false;
    const caught = await breaker
      .execute(async () => {
        dispatched = true;
      })
      .then(() => undefined)
      .catch((e: unknown) => e);

    assert(!dispatched, 'an open circuit does not dispatch the call');
    assert(caught instanceof CircuitOpenError, 'an open circuit throws CircuitOpenError');
    assert(
      (caught as CircuitOpenError).retryAfterMs > 0,
      'CircuitOpenError reports the remaining cooldown',
    );
  }

  {
    let clock = 1_000_000;
    const breaker = new CircuitBreaker('provider', {
      failureThreshold: 1,
      cooldownMs: 5_000,
      now: () => clock,
    });

    await trip(breaker, 1);
    clock += 4_999;
    assert(breaker.currentState() === 'open', 'stays open until the cooldown elapses');
    clock += 1;
    assert(breaker.currentState() === 'half_open', 'half-opens once the cooldown elapses');
    assert(
      (await breaker.execute(async () => 'recovered')) === 'recovered' &&
        breaker.currentState() === 'closed',
      'a successful probe closes the circuit',
    );

    await trip(breaker, 1);
    clock += 5_000;
    assert(breaker.currentState() === 'half_open', 'reopens and cools down again after reuse');
    await trip(breaker, 1);
    assert(breaker.currentState() === 'open', 'a failed probe reopens the circuit');
    clock += 4_999;
    assert(breaker.currentState() === 'open', 'a failed probe restarts the cooldown');
  }

  {
    const breaker = new CircuitBreaker('provider', { failureThreshold: 3 });
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    assert(breaker.failureCount() === 0, 'a success clears the consecutive failure count');
  }

  {
    let clock = 3_000_000;
    const breaker = new CircuitBreaker('provider', {
      failureThreshold: 1,
      cooldownMs: 1_000,
      successThreshold: 2,
      now: () => clock,
    });

    breaker.recordFailure();
    clock += 1_000;
    await breaker.execute(async () => 'first');
    assert(
      breaker.currentState() === 'half_open',
      'one success is not enough when successThreshold is 2',
    );
    await breaker.execute(async () => 'second');
    assert(breaker.currentState() === 'closed', 'closes after sustained recovery');
  }

  {
    const breaker = new CircuitBreaker('provider', {
      failureThreshold: 1,
      onStateChange: () => {
        throw new Error('listener exploded');
      },
    });

    const caught = await breaker
      .execute(async () => {
        throw err(503);
      })
      .catch((e: unknown) => e);

    assert(
      (caught as { status?: number }).status === 503,
      'a throwing listener does not replace the error that tripped the circuit',
    );
    assert(breaker.currentState() === 'open', 'a throwing listener does not corrupt breaker state');
  }

  {
    let clock = 4_000_000;
    const breaker = new CircuitBreaker('provider', {
      failureThreshold: 1,
      cooldownMs: 1_000,
      now: () => clock,
    });

    breaker.recordFailure();
    clock += 1_000;

    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probe = () =>
      breaker.execute(async () => {
        started += 1;
        await gate;
        return 'ok';
      });

    const first = probe();
    const second = await probe().catch((e: unknown) => e);
    release();
    await first;

    assert(started === 1, 'half-open admits exactly one probe', `started=${started}`);
    assert(
      second instanceof CircuitOpenError,
      'a concurrent probe is rejected while one is in flight',
    );
  }

  for (const field of ['failureThreshold', 'cooldownMs', 'successThreshold'] as const) {
    let threw = false;
    try {
      new CircuitBreaker('provider', { [field]: 0 });
    } catch (e) {
      threw = e instanceof TypeError;
    }
    assert(threw, `rejects a non-positive ${field}`);
  }

  // ------------------------------------------------------- ResilientModelAdapter

  const fastRetry = { maxAttempts: 3, initialDelayMs: 1, jitter: 0, sleep: async () => {} };

  {
    const flaky = flakyAdapter(1);
    const retries: RetryAttemptEvent[] = [];
    const resilient = new ResilientModelAdapter(
      flaky.adapter,
      { retry: fastRetry },
      { onRetry: (e) => void retries.push(e) },
    );

    const result = await resilient.generate(request);
    assert(result.content === 'ok', 'adapter retries a transient generate failure');
    assert(retries.length === 1, 'adapter surfaces the retry to its hook');
  }

  {
    const alwaysFails = flakyAdapter(Number.POSITIVE_INFINITY);
    const transitions: CircuitStateChangeEvent[] = [];
    const resilient = new ResilientModelAdapter(
      alwaysFails.adapter,
      {
        retry: { ...fastRetry, maxAttempts: 2 },
        circuitBreaker: { failureThreshold: 2, cooldownMs: 60_000 },
      },
      { onCircuitStateChange: (e) => void transitions.push(e) },
    );

    for (let i = 0; i < 2; i++) {
      await resilient.generate(request).catch(() => undefined);
    }

    assert(
      alwaysFails.calls() === 4,
      'each call spends its own retry budget',
      `${alwaysFails.calls()}`,
    );
    assert(
      resilient.circuitState() === 'open',
      'exhausted retries count as one failure, so 2 calls trip a threshold of 2',
      String(resilient.circuitState()),
    );
    assert(transitions.length === 1, 'adapter surfaces the circuit transition');

    const caught = await resilient.generate(request).catch((e: unknown) => e);
    assert(caught instanceof CircuitOpenError, 'subsequent calls fail fast while open');
    assert(alwaysFails.calls() === 4, 'a fail-fast rejection does not reach the adapter');
  }

  {
    const bare = flakyAdapter(Number.POSITIVE_INFINITY);
    const resilient = new ResilientModelAdapter(bare.adapter, {});
    await resilient.generate(request).catch(() => undefined);
    assert(bare.calls() === 1, 'no retry config means a single attempt', `${bare.calls()}`);
    assert(resilient.circuitState() === undefined, 'no breaker config means no circuit');
  }

  {
    const nonStreaming = new ResilientModelAdapter(flakyAdapter(0).adapter, { retry: fastRetry });
    assert(
      nonStreaming.stream === undefined,
      'stream stays absent when the wrapped adapter cannot stream',
    );
  }

  {
    let attempts = 0;
    const adapter: ModelAdapter = {
      async generate() {
        return response('unused');
      },
      async *stream(): AsyncIterable<ModelStreamChunk> {
        attempts += 1;
        if (attempts === 1) throw err(503);
        yield { type: 'token', text: 'he' };
        yield { type: 'token', text: 'llo' };
        yield { type: 'response', response: response('hello') };
      },
    };

    const resilient = new ResilientModelAdapter(adapter, { retry: fastRetry });
    const tokens: string[] = [];
    for await (const chunk of resilient.stream!(request)) {
      if (chunk.type === 'token' && chunk.text) tokens.push(chunk.text);
    }

    assert(
      tokens.join('') === 'hello' && attempts === 2,
      'a stream failing before its first chunk is retried',
      `tokens=${tokens.join('')} attempts=${attempts}`,
    );
  }

  {
    let attempts = 0;
    const adapter: ModelAdapter = {
      async generate() {
        return response('unused');
      },
      async *stream(): AsyncIterable<ModelStreamChunk> {
        attempts += 1;
        yield { type: 'token', text: 'partial' };
        throw err(503);
      },
    };

    const resilient = new ResilientModelAdapter(adapter, { retry: fastRetry });
    const tokens: string[] = [];
    let caught: unknown;
    try {
      for await (const chunk of resilient.stream!(request)) {
        if (chunk.type === 'token' && chunk.text) tokens.push(chunk.text);
      }
    } catch (e) {
      caught = e;
    }

    assert(
      caught !== undefined && attempts === 1 && tokens.join('') === 'partial',
      'a failure after the first chunk propagates instead of duplicating output',
      `attempts=${attempts} tokens=${tokens.join('')}`,
    );
  }

  {
    const adapter: ModelAdapter = {
      async generate() {
        return response('unused');
      },
      async *stream(): AsyncIterable<ModelStreamChunk> {
        yield { type: 'token', text: 'partial' };
        throw err(503);
      },
    };

    const resilient = new ResilientModelAdapter(adapter, {
      circuitBreaker: { failureThreshold: 2, cooldownMs: 60_000 },
    });

    for (let i = 0; i < 2; i++) {
      try {
        for await (const _ of resilient.stream!(request)) {
          // drain until it throws
        }
      } catch {
        // expected
      }
    }

    assert(
      resilient.circuitState() === 'open',
      'mid-stream failures count toward the circuit threshold',
      String(resilient.circuitState()),
    );
  }

  {
    let returned = false;
    const adapter: ModelAdapter = {
      async generate() {
        return response('unused');
      },
      stream() {
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                return { done: false, value: { type: 'token', text: 'x' } as ModelStreamChunk };
              },
              async return() {
                returned = true;
                return { done: true, value: undefined };
              },
            } as AsyncIterator<ModelStreamChunk>;
          },
        };
      },
    };

    const resilient = new ResilientModelAdapter(adapter, { retry: fastRetry });
    for await (const _ of resilient.stream!(request)) {
      break;
    }

    assert(returned, 'abandoning the stream closes the provider iterator');
  }

  {
    const shared = new CircuitBreaker('shared', { failureThreshold: 2, cooldownMs: 60_000 });
    const failing = flakyAdapter(Number.POSITIVE_INFINITY);

    for (let i = 0; i < 2; i++) {
      const perRequest = new ResilientModelAdapter(failing.adapter, { circuitBreaker: shared });
      await perRequest.generate(request).catch(() => undefined);
    }

    assert(
      shared.currentState() === 'open',
      'a shared breaker accumulates state across per-request wrappers',
      String(shared.currentState()),
    );
  }

  {
    const framework = flakyAdapter(Number.POSITIVE_INFINITY, () => new AgenticError('misconfigured'));
    const resilient = new ResilientModelAdapter(framework.adapter, { retry: { ...fastRetry, maxAttempts: 4 } });
    await resilient.generate(request).catch(() => undefined);
    assert(
      framework.calls() === 1,
      'framework errors are not retried through the adapter',
      `${framework.calls()}`,
    );
  }

  console.log(`\n  📊 Model Resilience Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Model Resilience Unit Tests Failed');
  }
}

if (require.main === module) {
  runModelResilienceTests().catch(() => process.exit(1));
}
