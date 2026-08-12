import type {
  ModelAdapter,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
  ModelToolSchema,
  ModelUsage,
} from '../interfaces/model.interface';
import type { ModelConfig } from '../interfaces/runtime.interface';

/**
 * User message the contract harness always sends.
 * Adapter factories can key their scripted provider on this value.
 */
export const CONTRACT_USER_MESSAGE = 'Contract: look up order 42';

/** System message the harness always sends. */
export const CONTRACT_SYSTEM_MESSAGE = 'You are a contract test harness.';

/** Tool schemas the harness advertises, covering required, optional, and array parameters. */
export const CONTRACT_TOOLS: ModelToolSchema[] = [
  {
    name: 'lookupOrder',
    description: 'Look up an order',
    parameters: [
      { name: 'orderId', type: 'string', required: true, description: 'Order identifier' },
      { name: 'includeHistory', type: 'boolean' },
      { name: 'tags', type: 'array' },
    ],
  },
];

/** One model round a scripted provider should produce. */
export interface ModelAdapterContractScenario {
  /** Text the provider returns for this round. */
  content?: string;
  /** Tool calls the provider requests for this round. */
  toolCalls?: ModelToolCall[];
  /** Usage the provider reports, when it is able to. */
  usage?: ModelUsage;
}

export interface ModelAdapterContractOptions {
  /** Adapter name used in the report. */
  name: string;
  /**
   * Builds an adapter whose provider deterministically produces the scenario.
   * Called once per assertion group, so the adapter may be stateful.
   */
  createAdapter(
    scenario: ModelAdapterContractScenario,
  ): ModelAdapter | Promise<ModelAdapter>;
  /** Set false when the adapter intentionally omits `stream()`. Default: true */
  supportsStreaming?: boolean;
  /** Set false when the provider cannot report token usage. Default: true */
  reportsUsage?: boolean;
  /** Model configuration passed to the adapter. */
  model?: ModelConfig;
  /** Set false to keep the report quiet. Default: true */
  log?: boolean;
}

export interface ModelAdapterContractResult {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  failures: string[];
}

const FINISH_REASONS = ['stop', 'tool_calls', 'length', 'content_filter', 'unknown'];

/**
 * Behavioral contract for a `ModelAdapter`.
 *
 * A compliant adapter performs one provider round per call and translates the
 * result into framework types. It does not execute tools, evaluate policies, or
 * loop, because `AgentExecutor` owns that behavior.
 *
 * Run this against any adapter, including third-party implementations, to check
 * it behaves the way the runtime expects.
 *
 * @example
 * const result = await runModelAdapterContract({
 *   name: 'MyModelAdapter',
 *   createAdapter: (scenario) => new MyModelAdapter({ fetch: stubFor(scenario) }),
 * });
 * if (result.failed > 0) throw new Error('Adapter is not contract compliant');
 */
export async function runModelAdapterContract(
  options: ModelAdapterContractOptions,
): Promise<ModelAdapterContractResult> {
  const supportsStreaming = options.supportsStreaming ?? true;
  const reportsUsage = options.reportsUsage ?? true;
  const model = options.model ?? { provider: 'contract', model: 'contract-model' };
  const log = options.log ?? true;

  const result: ModelAdapterContractResult = {
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

  function skip(assertion: string) {
    result.skipped++;
    if (log) console.log(`  ⏭️  SKIP: ${assertion}`);
  }

  function buildRequest(
    overrides: Partial<ModelRequest> = {},
  ): ModelRequest {
    return {
      model,
      messages: [
        { role: 'system', content: CONTRACT_SYSTEM_MESSAGE },
        { role: 'user', content: CONTRACT_USER_MESSAGE },
      ],
      tools: CONTRACT_TOOLS,
      metadata: {
        sessionId: 'contract_session',
        traceId: 'contract_trace',
        executionId: 'contract_execution',
        iteration: 0,
      },
      ...overrides,
    };
  }

  async function adapterFor(scenario: ModelAdapterContractScenario): Promise<ModelAdapter> {
    return options.createAdapter(scenario);
  }

  if (log) {
    console.log(`\n🔧 ModelAdapter contract: ${options.name}\n`);
  }

  // GROUP 1: a text-only round
  try {
    const adapter = await adapterFor({ content: 'Order 42 is on its way.' });
    const request = buildRequest();
    const messageCount = request.messages.length;
    const response = await adapter.generate(request);

    check(typeof response.content === 'string', 'generate() resolves content as a string');
    check(
      response.content === 'Order 42 is on its way.',
      'generate() returns the provider text unchanged',
      `received "${response.content}"`,
    );
    check(
      !response.toolCalls || response.toolCalls.length === 0,
      'generate() reports no tool calls for a text round',
    );
    check(
      request.messages.length === messageCount,
      'generate() does not mutate the request messages',
    );
    check(
      response.finishReason === undefined || FINISH_REASONS.includes(response.finishReason),
      'generate() reports a known finish reason',
      String(response.finishReason),
    );
  } catch (err) {
    fail('generate() handles a text round', describe(err));
  }

  // GROUP 2: a tool-calling round
  try {
    const adapter = await adapterFor({
      toolCalls: [
        {
          id: 'contract_call_1',
          name: 'lookupOrder',
          args: { orderId: '42', includeHistory: true },
        },
      ],
    });

    const response = await adapter.generate(buildRequest());
    const call = response.toolCalls?.[0];

    check(response.toolCalls?.length === 1, 'generate() returns the requested tool call');
    check(typeof call?.id === 'string' && call.id.length > 0, 'tool call carries a correlation id');
    check(call?.name === 'lookupOrder', 'tool call carries the tool name');
    check(
      Boolean(call?.args) && typeof call?.args === 'object' && !Array.isArray(call?.args),
      'tool call arguments are a parsed object, not a string',
      typeof call?.args,
    );
    check(
      call?.args.orderId === '42' && call?.args.includeHistory === true,
      'tool call arguments preserve provider values and types',
      JSON.stringify(call?.args),
    );
    check(typeof response.content === 'string', 'content is still a string on a tool round');
  } catch (err) {
    fail('generate() handles a tool-calling round', describe(err));
  }

  // GROUP 3: a full conversation, including prior tool results
  try {
    const adapter = await adapterFor({ content: 'Done.' });
    const history: ModelMessage[] = [
      { role: 'system', content: CONTRACT_SYSTEM_MESSAGE },
      { role: 'user', content: CONTRACT_USER_MESSAGE },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'contract_call_1', name: 'lookupOrder', args: { orderId: '42' } }],
      },
      {
        role: 'tool',
        toolCallId: 'contract_call_1',
        toolName: 'lookupOrder',
        content: '{"success":true,"data":{"status":"shipped"}}',
      },
    ];

    const response = await adapter.generate(buildRequest({ messages: history }));
    check(typeof response.content === 'string', 'generate() accepts assistant and tool messages');
  } catch (err) {
    fail('generate() accepts a full conversation', describe(err));
  }

  // GROUP 4: usage reporting
  if (reportsUsage) {
    try {
      const adapter = await adapterFor({
        content: 'ok',
        usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
      });
      const response = await adapter.generate(buildRequest());

      check(Boolean(response.usage), 'generate() reports usage when the provider supplies it');
      check(
        response.usage?.totalTokens === 18 ||
          (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0) === 18,
        'usage maps onto framework token fields',
        JSON.stringify(response.usage),
      );
    } catch (err) {
      fail('generate() maps usage', describe(err));
    }
  } else {
    skip('generate() maps usage');
  }

  // GROUP 5: cancellation
  try {
    const adapter = await adapterFor({ content: 'should not be returned' });
    const controller = new AbortController();
    controller.abort();

    let rejected = false;
    try {
      await adapter.generate(buildRequest({ signal: controller.signal }));
    } catch {
      rejected = true;
    }

    check(rejected, 'generate() rejects when the request signal is already aborted');
  } catch (err) {
    fail('generate() honors cancellation', describe(err));
  }

  // GROUP 6: streaming
  if (!supportsStreaming) {
    skip('stream() emits tokens and a final response');
  } else {
    try {
      const adapter = await adapterFor({
        content: 'Streaming answer',
        toolCalls: [
          { id: 'contract_call_2', name: 'lookupOrder', args: { orderId: '42' } },
        ],
      });

      if (!adapter.stream) {
        fail('stream() is implemented', 'supportsStreaming was true but stream() is missing');
      } else {
        const chunks: Array<{ type: string }> = [];
        let tokens = '';
        let final: ModelResponse | undefined;

        for await (const chunk of adapter.stream(buildRequest())) {
          chunks.push(chunk);
          if (chunk.type === 'token') tokens += chunk.text;
          else final = chunk.response;
        }

        const responseChunks = chunks.filter((c) => c.type === 'response');

        check(responseChunks.length === 1, 'stream() emits exactly one response chunk');
        check(
          chunks[chunks.length - 1]?.type === 'response',
          'stream() emits the response chunk last',
        );
        check(
          final?.content === 'Streaming answer',
          'final response carries the complete round text',
          `received "${final?.content}"`,
        );
        check(
          tokens === '' || tokens === 'Streaming answer',
          'streamed tokens concatenate to the round text',
          `received "${tokens}"`,
        );
        check(
          final?.toolCalls?.[0]?.name === 'lookupOrder',
          'final response includes tool calls requested while streaming',
        );
        check(
          typeof final?.toolCalls?.[0]?.args === 'object',
          'streamed tool call arguments are parsed into an object',
        );
      }
    } catch (err) {
      fail('stream() satisfies the contract', describe(err));
    }
  }

  if (log) {
    console.log(
      `\n  📊 ${options.name} contract: ${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped.\n`,
    );
  }

  return result;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
