import OpenAI from 'openai';
import type { ModelRequest } from '@nestjs-agentic/core';
import { OpenAiModelAdapter, OpenAiModelError, toOpenAiMessages, toOpenAiTools } from '../src';

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: any;
}

type StubFetch = (input: any, init?: any) => Promise<Response>;

function headersToObject(init: any): Record<string, string> {
  const raw = init?.headers;
  if (!raw) return {};
  if (typeof raw.forEach === 'function' && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    (raw as Headers).forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  return Object.fromEntries(
    Object.entries(raw as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
  );
}

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Builds a real SSE response so the SDK performs its own stream decoding. */
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function createRecorder(responses: Array<() => Response>): {
  fetch: StubFetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetch: StubFetch = async (input, init) => {
    calls.push({
      url: String(input),
      headers: headersToObject(init),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const factory = responses[Math.min(index, responses.length - 1)];
    index++;
    return factory();
  };

  return { fetch, calls };
}

function buildAdapter(
  fetch: StubFetch,
  options: Partial<ConstructorParameters<typeof OpenAiModelAdapter>[0]> = {},
) {
  return new OpenAiModelAdapter({
    apiKey: 'sk-test',
    maxRetries: 0,
    ...options,
    clientOptions: { fetch: fetch as any, ...options.clientOptions },
  });
}

function buildRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    model: { provider: 'openai', model: 'gpt-4o-mini' },
    messages: [
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: 'Refund order 42' },
    ],
    tools: [
      {
        name: 'refundOrder',
        description: 'Refund an order',
        parameters: [
          { name: 'orderId', type: 'string', required: true, description: 'Order id' },
          { name: 'amount', type: 'number', required: true },
          { name: 'tags', type: 'array' },
        ],
      },
    ],
    metadata: {
      sessionId: 'sess_1',
      traceId: 'trace_1',
      executionId: 'exec_1',
      iteration: 0,
    },
    ...overrides,
  };
}

async function main() {
  console.log('🔌 Running @nestjs-agentic/openai Adapter Tests...\n');

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

  // TEST 1: Request shape and tool schema translation through the SDK
  try {
    const { fetch, calls } = createRecorder([
      () => jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'Done.' } }] }),
    ]);

    const adapter = buildAdapter(fetch, {
      baseUrl: 'https://example.test/v1',
      temperature: 0.2,
      maxTokens: 256,
    });

    await adapter.generate(buildRequest());
    const call = calls[0];

    assert(call.url === 'https://example.test/v1/chat/completions', 'Test 1a: Base URL honored');
    assert(call.headers.authorization === 'Bearer sk-test', 'Test 1b: SDK sends bearer token');
    assert(call.body.model === 'gpt-4o-mini', 'Test 1c: Model name forwarded');
    assert(
      call.body.temperature === 0.2 && call.body.max_tokens === 256,
      'Test 1d: Sampling options forwarded',
    );
    assert(call.body.stream === false, 'Test 1e: Non-streaming request marked explicitly');

    const fn = call.body.tools[0].function;
    assert(fn.name === 'refundOrder', 'Test 1f: Tool name mapped');
    assert(fn.parameters.properties.orderId.type === 'string', 'Test 1g: Declared types mapped');
    assert(
      fn.parameters.properties.tags.type === 'array' &&
        typeof fn.parameters.properties.tags.items === 'object',
      'Test 1h: Array parameters include an items schema',
    );
    assert(
      JSON.stringify(fn.parameters.required) === JSON.stringify(['orderId', 'amount']),
      'Test 1i: Only required parameters listed as required',
    );
  } catch (err: any) {
    assert(false, 'Test 1: Request construction', err.message);
  }

  // TEST 2: Tool call and usage parsing
  try {
    const { fetch } = createRecorder([
      () =>
        jsonResponse({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_abc',
                    type: 'function',
                    function: { name: 'refundOrder', arguments: '{"orderId":"42","amount":600}' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 },
        }),
    ]);

    const response = await buildAdapter(fetch).generate(buildRequest());

    assert(response.finishReason === 'tool_calls', 'Test 2a: finish_reason mapped');
    assert(response.content === '', 'Test 2b: Null content normalized to empty string');
    assert(response.toolCalls?.[0].id === 'call_abc', 'Test 2c: Provider tool call id preserved');
    assert(
      response.toolCalls?.[0].args.orderId === '42' && response.toolCalls?.[0].args.amount === 600,
      'Test 2d: JSON string arguments parsed into an object',
    );
    assert(
      response.usage?.inputTokens === 30 && response.usage?.totalTokens === 42,
      'Test 2e: Usage mapped to framework fields',
    );
  } catch (err: any) {
    assert(false, 'Test 2: Tool call parsing', err.message);
  }

  // TEST 3: Malformed tool arguments degrade to an empty object
  try {
    const { fetch } = createRecorder([
      () =>
        jsonResponse({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                tool_calls: [
                  { id: 'c1', type: 'function', function: { name: 'refundOrder', arguments: '{"orderId": ' } },
                ],
              },
            },
          ],
        }),
    ]);

    const response = await buildAdapter(fetch).generate(buildRequest());

    assert(
      JSON.stringify(response.toolCalls?.[0].args) === '{}',
      'Test 3a: Invalid JSON arguments become an empty object for executor validation',
    );
  } catch (err: any) {
    assert(false, 'Test 3: Malformed arguments', err.message);
  }

  // TEST 4: Streaming through the SDK, including fragmented tool-call deltas
  try {
    const { fetch, calls } = createRecorder([
      () =>
        sseResponse([
          'data: {"choices":[{"index":0,"delta":{"content":"Check"}}]}\n\n',
          'data: {"choices":[{"index":0,"delta":{"content":"ing"}}]}\n\n',
          'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_x","type":"function","function":{"name":"refund',
          'Order","arguments":"{\\"orderId\\":"}}]}}]}\n\n',
          'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"42\\"}"}}]}}]}\n\n',
          ': keep-alive\n\n',
          'data: {"choices":[{"index":0,"finish_reason":"tool_calls","delta":{}}],"usage":{"prompt_tokens":9,"completion_tokens":3,"total_tokens":12}}\n\n',
          'data: [DONE]\n\n',
        ]),
    ]);

    const tokens: string[] = [];
    let final: any;

    for await (const chunk of buildAdapter(fetch).stream(buildRequest())) {
      if (chunk.type === 'token') tokens.push(chunk.text);
      else final = chunk.response;
    }

    assert(calls[0].body.stream === true, 'Test 4a: Streaming request sets stream flag');
    assert(
      calls[0].body.stream_options?.include_usage === true,
      'Test 4b: Usage requested for the final chunk',
    );
    assert(tokens.join('') === 'Checking', 'Test 4c: Content deltas streamed as tokens');
    assert(final.content === 'Checking', 'Test 4d: Final response carries accumulated content');
    assert(final.toolCalls.length === 1, 'Test 4e: Fragmented tool call assembled');
    assert(final.toolCalls[0].name === 'refundOrder', 'Test 4f: Tool name joined across chunks');
    assert(
      final.toolCalls[0].args.orderId === '42',
      'Test 4g: Argument fragments concatenated then parsed',
    );
    assert(final.usage.totalTokens === 12, 'Test 4h: Streaming usage mapped');
    assert(final.finishReason === 'tool_calls', 'Test 4i: Streaming finish reason mapped');
  } catch (err: any) {
    assert(false, 'Test 4: Streaming', err.message);
  }

  // TEST 5: SDK retries transient failures
  try {
    let attempts = 0;
    const fetch: StubFetch = async () => {
      attempts++;
      return attempts === 1
        ? jsonResponse({ error: { message: 'slow down' } }, 429, { 'retry-after': '0' })
        : jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'Recovered.' } }] });
    };

    const response = await buildAdapter(fetch, { maxRetries: 2 }).generate(buildRequest());

    assert(attempts === 2, 'Test 5a: Retried once after a 429');
    assert(response.content === 'Recovered.', 'Test 5b: Successful retry result returned');
  } catch (err: any) {
    assert(false, 'Test 5: Retry behavior', err.message);
  }

  // TEST 6: Client errors are wrapped, not retried, and never leak the key
  try {
    let attempts = 0;
    const fetch: StubFetch = async () => {
      attempts++;
      return jsonResponse({ error: { message: 'Invalid tool schema' } }, 400);
    };

    const adapter = buildAdapter(fetch, { apiKey: 'sk-secret-value', maxRetries: 3 });

    let caught: any;
    try {
      await adapter.generate(buildRequest());
    } catch (err) {
      caught = err;
    }

    assert(caught instanceof OpenAiModelError, 'Test 6a: Throws OpenAiModelError');
    assert(attempts === 1, 'Test 6b: 400 responses are not retried');
    assert(caught.status === 400, 'Test 6c: Status preserved on the error');
    assert(
      String(caught.message).includes('Invalid tool schema'),
      'Test 6d: Provider message surfaced',
    );
    assert(
      !String(caught.message).includes('sk-secret-value'),
      'Test 6e: API key never included in the error message',
    );
    assert(caught.cause !== undefined, 'Test 6f: Original SDK error retained as cause');
  } catch (err: any) {
    assert(false, 'Test 6: Client error handling', err.message);
  }

  // TEST 7: Cancellation surfaces as an aborted OpenAiModelError
  try {
    const fetch: StubFetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal: AbortSignal | undefined = init?.signal;
        if (signal?.aborted) {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          return;
        }
        signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });

    const controller = new AbortController();
    controller.abort();

    let caught: any;
    try {
      await buildAdapter(fetch).generate(buildRequest({ signal: controller.signal }));
    } catch (err) {
      caught = err;
    }

    assert(caught instanceof OpenAiModelError, 'Test 7a: Aborted request raises OpenAiModelError');
    assert(caught.code === 'aborted', 'Test 7b: Abort reported with an aborted code');
  } catch (err: any) {
    assert(false, 'Test 7: Cancellation', err.message);
  }

  // TEST 8: Message translation matches the provider contract
  try {
    const mapped = toOpenAiMessages([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'refundOrder', args: { orderId: '1' } }],
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'refundOrder', content: '{"success":true}' },
    ]) as any[];

    assert(mapped[2].content === null, 'Test 8a: Empty assistant content sent as null');
    assert(
      mapped[2].tool_calls[0].function.arguments === '{"orderId":"1"}',
      'Test 8b: Tool call arguments serialized to JSON text',
    );
    assert(mapped[3].tool_call_id === 'c1', 'Test 8c: Tool result correlated by tool_call_id');
    assert(
      !Object.prototype.hasOwnProperty.call(mapped[3], 'toolName'),
      'Test 8d: Framework-only fields not sent to the provider',
    );
    assert(toOpenAiTools([]).length === 0, 'Test 8e: Empty tool list maps to an empty array');
  } catch (err: any) {
    assert(false, 'Test 8: Message translation', err.message);
  }

  // TEST 9: Compatible servers and reasoning-model token caps
  try {
    const { fetch, calls } = createRecorder([
      () => jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'local' } }] }),
    ]);

    const adapter = buildAdapter(fetch, {
      apiKey: 'not-needed',
      baseUrl: 'http://localhost:11434/v1',
      maxTokens: 100,
      maxCompletionTokens: 4096,
      extraBody: { keep_alive: '5m' },
    });

    await adapter.generate(buildRequest());

    assert(
      calls[0].url === 'http://localhost:11434/v1/chat/completions',
      'Test 9a: Custom base URL used for compatible servers',
    );
    assert(calls[0].body.keep_alive === '5m', 'Test 9b: extraBody merged into the payload');
    assert(
      calls[0].body.max_completion_tokens === 4096 && calls[0].body.max_tokens === undefined,
      'Test 9c: maxCompletionTokens replaces max_tokens for reasoning models',
    );
  } catch (err: any) {
    assert(false, 'Test 9: Compatible server configuration', err.message);
  }

  // TEST 10: A pre-configured SDK client is used as provided
  try {
    const { fetch, calls } = createRecorder([
      () => jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'via client' } }] }),
    ]);

    const client = new OpenAI({
      apiKey: 'sk-injected',
      baseURL: 'https://injected.test/v1',
      maxRetries: 0,
      fetch: fetch as any,
    });

    const adapter = new OpenAiModelAdapter({ client });
    const response = await adapter.generate(buildRequest());

    assert(adapter.getClient() === client, 'Test 10a: Injected client exposed through getClient()');
    assert(
      calls[0].url === 'https://injected.test/v1/chat/completions',
      'Test 10b: Injected client configuration used',
    );
    assert(response.content === 'via client', 'Test 10c: Response returned through injected client');
  } catch (err: any) {
    assert(false, 'Test 10: Injected client', err.message);
  }

  console.log(`\n  📊 OpenAI Adapter Results: ${passed} passed, ${failed} failed.\n`);

  if (failed > 0) {
    console.error('❌ TEST SUITE FAILURE: OpenAI adapter tests failed.');
    process.exit(1);
  }

  console.log('🎉 OPENAI ADAPTER TEST SUITE PASSED SUCCESSFULLY!\n');
}

main().catch((err) => {
  console.error('❌ TEST SUITE FAILURE:', err);
  process.exit(1);
});
