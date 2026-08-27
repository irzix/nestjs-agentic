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

function statusError(status: number, message = `HTTP ${status}`): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

const request: ModelRequest = {
  model: { model: 'test-model' },
  messages: [{ role: 'user', content: 'hi' }],
  tools: [],
  metadata: { sessionId: 'sess_res', traceId: 'trace_res', executionId: 'exec_res', iteration: 0 },
};

function response(content: string): ModelResponse {
  return { content, toolCalls: [] };
}

/** Adapter that fails a fixed number of times before succeeding. */
function createFlakyAdapter(failures: number, error: () => Error = () => statusError(503)) {
  let calls = 0;
  const adapter: ModelAdapter = {
    async generate() {
      calls += 1;
      if (calls <= failures) throw error();
      return response('ok');
    },
  };
  return {
    adapter,
    callCount: () => calls,
  };
}

export async function runModelResilienceTests() {
  console.log('\n🛡️  Model Call Resilience (Retry + Circuit Breaker) Tests\n');
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

  // ---------------------------------------------------------------- retryability

  assert(isRetryableModelError(statusError(503)), 'Test 1: 503 is retryable');
  assert(isRetryableModelError(statusError(429)), 'Test 2: 429 is retryable');
  assert(!isRetryableModelError(statusError(400)), 'Test 3: 400 is not retryable');
  assert(!isRetryableModelError(statusError(401)), 'Test 4: 401 is not retryable');
  assert(
    isRetryableModelError(new Error('socket hang up')),
    'Test 5: status-less network error is retryable',
  );
  assert(
    !isRetryableModelError(new AgenticError('bad config')),
    'Test 6: AgenticError is never retried',
  );
  assert(
    !isRetryableModelError(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    'Test 7: AbortError is never retried',
  );

  // ------------------------------------------------------------- Retry-After hint

  assert(readRetryAfterMs({ retryAfterMs: 1500 }) === 1500, 'Test 8: reads retryAfterMs');
  assert(readRetryAfterMs({ retryAfterSeconds: 2 }) === 2000, 'Test 9: reads retryAfterSeconds');
  assert(readRetryAfterMs({ retryAfter: '3' }) === 3000, 'Test 10: reads string retryAfter header');
  assert(readRetryAfterMs(new Error('none')) === undefined, 'Test 11: no hint returns undefined');

  // --------------------------------------------------------------- retry behavior

  {
    const flaky = createFlakyAdapter(2);
    const delays: number[] = [];
    const result = await retryWithBackoff(() => flaky.adapter.generate(request), {
      maxAttempts: 3,
      initialDelayMs: 100,
      jitter: 0,
      sleep: async (ms) => void delays.push(ms),
    });

    assert(result.content === 'ok', 'Test 12: succeeds after transient failures');
    assert(flaky.callCount() === 3, 'Test 13: attempted exactly 3 times', `got ${flaky.callCount()}`);
    assert(
      delays.length === 2 && delays[0] === 100 && delays[1] === 200,
      'Test 14: backoff doubles between attempts',
      JSON.stringify(delays),
    );
  }

  {
    const delays: number[] = [];
    let calls = 0;
    try {
      await retryWithBackoff(
        async () => {
          calls += 1;
          throw statusError(500);
        },
        { maxAttempts: 3, initialDelayMs: 100, jitter: 0, sleep: async (ms) => void delays.push(ms) },
      );
      assert(false, 'Test 15: rethrows after exhausting attempts');
    } catch (err) {
      assert(
        (err as { status?: number }).status === 500 && calls === 3,
        'Test 15: rethrows after exhausting attempts',
        `calls=${calls}`,
      );
    }
  }

  {
    let calls = 0;
    try {
      await retryWithBackoff(
        async () => {
          calls += 1;
          throw statusError(400);
        },
        { maxAttempts: 5, sleep: async () => {} },
      );
      assert(false, 'Test 16: non-retryable error fails immediately');
    } catch {
      assert(calls === 1, 'Test 16: non-retryable error fails immediately', `calls=${calls}`);
    }
  }

  {
    const delays: number[] = [];
    try {
      await retryWithBackoff(
        async () => {
          throw Object.assign(statusError(429), { retryAfterMs: 4321 });
        },
        { maxAttempts: 2, initialDelayMs: 50, jitter: 0, sleep: async (ms) => void delays.push(ms) },
      );
    } catch {
      // expected
    }
    assert(
      delays.length === 1 && delays[0] === 4321,
      'Test 17: provider Retry-After hint overrides computed backoff',
      JSON.stringify(delays),
    );
  }

  {
    const delays: number[] = [];
    try {
      await retryWithBackoff(
        async () => {
          throw Object.assign(statusError(429), { retryAfterMs: 900_000 });
        },
        {
          maxAttempts: 2,
          maxDelayMs: 5_000,
          jitter: 0,
          sleep: async (ms) => void delays.push(ms),
        },
      );
    } catch {
      // expected
    }
    assert(delays[0] === 5_000, 'Test 18: Retry-After hint is capped by maxDelayMs', String(delays[0]));
  }

  {
    const delays: number[] = [];
    await retryWithBackoff(
      (() => {
        let calls = 0;
        return async () => {
          calls += 1;
          if (calls === 1) throw statusError(503);
          return 'ok';
        };
      })(),
      {
        maxAttempts: 2,
        initialDelayMs: 1000,
        maxDelayMs: 10_000,
        jitter: 0.5,
        sleep: async (ms) => void delays.push(ms),
      },
    );

    assert(
      delays[0] >= 500 && delays[0] <= 1000,
      'Test 19: jitter keeps delay within [0.5x, 1x] of the computed backoff',
      String(delays[0]),
    );
  }

  {
    const spread = new Set<number>();
    for (let i = 0; i < 25; i++) {
      const delays: number[] = [];
      await retryWithBackoff(
        (() => {
          let calls = 0;
          return async () => {
            calls += 1;
            if (calls === 1) throw statusError(503);
            return 'ok';
          };
        })(),
        { maxAttempts: 2, initialDelayMs: 1000, jitter: 0.5, sleep: async (ms) => void delays.push(ms) },
      );
      spread.add(delays[0]);
    }
    assert(spread.size > 1, 'Test 20: jitter randomizes delays across callers', `distinct=${spread.size}`);
  }

  {
    const retries: RetryAttemptEvent[] = [];
    await retryWithBackoff(
      (() => {
        let calls = 0;
        return async () => {
          calls += 1;
          if (calls === 1) throw statusError(503);
          return 'ok';
        };
      })(),
      {
        maxAttempts: 2,
        initialDelayMs: 10,
        jitter: 0,
        sleep: async () => {},
        onRetry: (event) => void retries.push(event),
      },
    );
    assert(
      retries.length === 1 && retries[0].attempt === 1 && retries[0].maxAttempts === 2,
      'Test 21: onRetry reports attempt number and budget',
      JSON.stringify(retries.map((r) => r.attempt)),
    );
  }

  {
    let threw = false;
    try {
      await retryWithBackoff(async () => 'ok', { maxAttempts: 0 });
    } catch (err) {
      threw = err instanceof TypeError;
    }
    assert(threw, 'Test 22: rejects a non-positive maxAttempts');
  }

  // -------------------------------------------------------------- circuit breaker

  {
    const events: CircuitStateChangeEvent[] = [];
    const breaker = new CircuitBreaker('provider', {
      failureThreshold: 3,
      cooldownMs: 1000,
      onStateChange: (event) => void events.push(event),
    });

    assert(breaker.currentState() === 'closed', 'Test 23: starts closed');

    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw statusError(503);
        });
      } catch {
        // expected
      }
    }
    assert(breaker.currentState() === 'closed', 'Test 24: stays closed below the threshold');

    try {
      await breaker.execute(async () => {
        throw statusError(503);
      });
    } catch {
      // expected
    }
    assert(breaker.currentState() === 'open', 'Test 25: opens at the failure threshold');
    assert(
      events.some((e) => e.from === 'closed' && e.to === 'open'),
      'Test 26: emits the closed -> open transition',
    );
  }

  {
    const breaker = new CircuitBreaker('provider', { failureThreshold: 1, cooldownMs: 60_000 });
    try {
      await breaker.execute(async () => {
        throw statusError(500);
      });
    } catch {
      // expected
    }

    let dispatched = false;
    let caught: unknown;
    try {
      await breaker.execute(async () => {
        dispatched = true;
        return 'ok';
      });
    } catch (err) {
      caught = err;
    }

    assert(!dispatched, 'Test 27: open circuit does not dispatch the call');
    assert(caught instanceof CircuitOpenError, 'Test 28: open circuit throws CircuitOpenError');
    assert(
      (caught as CircuitOpenError).retryAfterMs > 0,
      'Test 29: CircuitOpenError reports remaining cooldown',
    );
  }

  {
    let clock = 1_000_000;
    const breaker = new CircuitBreaker('provider', {
      failureThreshold: 1,
      cooldownMs: 5_000,
      now: () => clock,
    });

    try {
      await breaker.execute(async () => {
        throw statusError(500);
      });
    } catch {
      // expected
    }
    assert(breaker.currentState() === 'open', 'Test 30: open after failure');

    clock += 5_000;
    assert(breaker.currentState() === 'half_open', 'Test 31: half-opens once cooldown elapses');

    const result = await breaker.execute(async () => 'recovered');
    assert(
      result === 'recovered' && breaker.currentState() === 'closed',
      'Test 32: successful probe closes the circuit',
    );
  }

  {
    let clock = 2_000_000;
    const breaker = new CircuitBreaker('provider', {
      failureThreshold: 1,
      cooldownMs: 5_000,
      now: () => clock,
    });

    try {
      await breaker.execute(async () => {
        throw statusError(500);
      });
    } catch {
      // expected
    }
    clock += 5_000;
    assert(breaker.currentState() === 'half_open', 'Test 33: probe window opened');

    try {
      await breaker.execute(async () => {
        throw statusError(500);
      });
    } catch {
      // expected
    }
    assert(breaker.currentState() === 'open', 'Test 34: failed probe reopens the circuit');

    clock += 4_999;
    assert(breaker.currentState() === 'open', 'Test 35: failed probe restarts the cooldown');
  }

  {
    const breaker = new CircuitBreaker('provider', { failureThreshold: 3 });
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    assert(breaker.failureCount() === 0, 'Test 36: a success clears the consecutive failure count');
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
    assert(breaker.currentState() === 'half_open', 'Test 37: half-open before sustained recovery');

    await breaker.execute(async () => 'first');
    assert(
      breaker.currentState() === 'half_open',
      'Test 38: one success is not enough when successThreshold is 2',
    );

    await breaker.execute(async () => 'second');
    assert(breaker.currentState() === 'closed', 'Test 39: closes after sustained recovery');
  }

  {
    let threw = false;
    try {
      new CircuitBreaker('provider', { failureThreshold: 0 });
    } catch (err) {
      threw = err instanceof TypeError;
    }
    assert(threw, 'Test 40: rejects a non-positive failureThreshold');
  }

  // ------------------------------------------------------- ResilientModelAdapter

  {
    const flaky = createFlakyAdapter(1);
    const retries: RetryAttemptEvent[] = [];
    const resilient = new ResilientModelAdapter(
      flaky.adapter,
      { retry: { maxAttempts: 3, initialDelayMs: 1, jitter: 0, sleep: async () => {} } },
      { onRetry: (event) => void retries.push(event) },
    );

    const result = await resilient.generate(request);
    assert(result.content === 'ok', 'Test 41: adapter retries a transient generate failure');
    assert(retries.length === 1, 'Test 42: adapter surfaces the retry to its hook');
  }

  {
    const alwaysFails: ModelAdapter = {
      async generate() {
        throw statusError(503);
      },
    };
    const transitions: CircuitStateChangeEvent[] = [];
    const resilient = new ResilientModelAdapter(
      alwaysFails,
      {
        retry: { maxAttempts: 2, initialDelayMs: 1, jitter: 0, sleep: async () => {} },
        circuitBreaker: { failureThreshold: 2, cooldownMs: 60_000 },
      },
      { onCircuitStateChange: (event) => void transitions.push(event) },
    );

    for (let i = 0; i < 2; i++) {
      try {
        await resilient.generate(request);
      } catch {
        // expected
      }
    }

    assert(
      resilient.circuitState() === 'open',
      'Test 43: exhausted retries count as one failure, so 2 calls trip a threshold of 2',
      String(resilient.circuitState()),
    );
    assert(transitions.length === 1, 'Test 44: adapter surfaces the circuit transition');

    let caught: unknown;
    try {
      await resilient.generate(request);
    } catch (err) {
      caught = err;
    }
    assert(caught instanceof CircuitOpenError, 'Test 45: subsequent calls fail fast while open');
  }

  {
    const noRetry: ModelAdapter = {
      async generate() {
        throw statusError(503);
      },
    };
    const resilient = new ResilientModelAdapter(noRetry, {});
    let calls = 0;
    const counting: ModelAdapter = {
      async generate() {
        calls += 1;
        throw statusError(503);
      },
    };
    const bare = new ResilientModelAdapter(counting, {});
    try {
      await bare.generate(request);
    } catch {
      // expected
    }
    assert(calls === 1, 'Test 46: no retry config means a single attempt', `calls=${calls}`);
    assert(resilient.circuitState() === undefined, 'Test 47: no breaker config means no circuit');
  }

  {
    const nonStreaming: ModelAdapter = {
      async generate() {
        return response('ok');
      },
    };
    const resilient = new ResilientModelAdapter(nonStreaming, { retry: { maxAttempts: 2 } });
    assert(
      resilient.stream === undefined,
      'Test 48: stream stays absent when the wrapped adapter cannot stream',
    );
  }

  {
    let attempts = 0;
    const flakyStream: ModelAdapter = {
      async generate() {
        return response('unused');
      },
      // eslint-disable-next-line require-yield
      async *stream(): AsyncIterable<ModelStreamChunk> {
        attempts += 1;
        if (attempts === 1) throw statusError(503);
        yield { type: 'token', text: 'he' };
        yield { type: 'token', text: 'llo' };
        yield { type: 'response', response: response('hello') };
      },
    };

    const resilient = new ResilientModelAdapter(flakyStream, {
      retry: { maxAttempts: 3, initialDelayMs: 1, jitter: 0, sleep: async () => {} },
    });

    const tokens: string[] = [];
    for await (const chunk of resilient.stream!(request)) {
      if (chunk.type === 'token' && chunk.text) tokens.push(chunk.text);
    }

    assert(
      tokens.join('') === 'hello' && attempts === 2,
      'Test 49: a stream failing before its first chunk is retried',
      `tokens=${tokens.join('')} attempts=${attempts}`,
    );
  }

  {
    let attempts = 0;
    const midStreamFailure: ModelAdapter = {
      async generate() {
        return response('unused');
      },
      async *stream(): AsyncIterable<ModelStreamChunk> {
        attempts += 1;
        yield { type: 'token', text: 'partial' };
        throw statusError(503);
      },
    };

    const resilient = new ResilientModelAdapter(midStreamFailure, {
      retry: { maxAttempts: 3, initialDelayMs: 1, jitter: 0, sleep: async () => {} },
    });

    const tokens: string[] = [];
    let caught: unknown;
    try {
      for await (const chunk of resilient.stream!(request)) {
        if (chunk.type === 'token' && chunk.text) tokens.push(chunk.text);
      }
    } catch (err) {
      caught = err;
    }

    assert(
      caught !== undefined && attempts === 1 && tokens.join('') === 'partial',
      'Test 50: a failure after the first chunk propagates instead of duplicating output',
      `attempts=${attempts} tokens=${tokens.join('')}`,
    );
  }

  {
    const failing: ModelAdapter = {
      async generate() {
        throw new AgenticError('misconfigured');
      },
    };
    let calls = 0;
    const counting: ModelAdapter = {
      async generate() {
        calls += 1;
        return failing.generate(request);
      },
    };
    const resilient = new ResilientModelAdapter(counting, {
      retry: { maxAttempts: 4, initialDelayMs: 1, jitter: 0, sleep: async () => {} },
    });

    try {
      await resilient.generate(request);
    } catch {
      // expected
    }
    assert(calls === 1, 'Test 51: framework errors are not retried through the adapter', `calls=${calls}`);
  }

  console.log(`\n  📊 Model Resilience Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Model Resilience Unit Tests Failed');
  }
}

if (require.main === module) {
  runModelResilienceTests().catch(() => process.exit(1));
}
