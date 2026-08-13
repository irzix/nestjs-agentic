import type {
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  ModelStreamChunk,
  ModelToolCall,
  ModelUsage,
} from '../interfaces/model.interface';

interface ScriptedToolCall {
  name: string;
  args?: Record<string, unknown>;
  id?: string;
}

type ScriptedTurn =
  | { kind: 'tool_calls'; content: string; calls: ScriptedToolCall[] }
  | { kind: 'reply'; content: string };

export interface MockModelAdapterOptions {
  /** Usage reported for every model round. Useful for token budget tests. */
  usagePerRound?: ModelUsage;
}

/** Fluent builder describing the scripted rounds for one user message. */
export interface MockModelScriptBuilder {
  /** Adds a round in which the model requests a single tool. */
  callTool(
    toolName: string,
    args?: Record<string, unknown>,
    options?: { content?: string; id?: string },
  ): MockModelScriptBuilder;
  /** Adds a round in which the model requests several tools at once. */
  callTools(calls: ScriptedToolCall[], options?: { content?: string }): MockModelScriptBuilder;
  /** Adds a final round in which the model answers without tool calls. */
  reply(content: string): MockModelAdapter;
}

/**
 * Deterministic ModelAdapter for testing agents, tools, policies, and the
 * built-in executor loop without contacting a provider.
 *
 * Rounds are selected by counting assistant messages already present in the
 * request, so scripts stay stable across concurrent executions.
 *
 * @example
 * const model = new MockModelAdapter();
 * model
 *   .whenAsked('Refund $600 for order #42')
 *   .callTool('refundOrder', { orderId: '42', amount: 600 })
 *   .reply('Refund submitted.');
 */
export class MockModelAdapter implements ModelAdapter {
  private readonly scripts = new Map<string, ScriptedTurn[]>();
  private readonly usagePerRound?: ModelUsage;

  constructor(options?: MockModelAdapterOptions) {
    this.usagePerRound = options?.usagePerRound;
  }

  whenAsked(message: string): MockModelScriptBuilder {
    const turns: ScriptedTurn[] = [];
    this.scripts.set(message, turns);

    const builder: MockModelScriptBuilder = {
      callTool: (toolName, args, options) => {
        turns.push({
          kind: 'tool_calls',
          content: options?.content ?? '',
          calls: [{ name: toolName, args, id: options?.id }],
        });
        return builder;
      },
      callTools: (calls, options) => {
        turns.push({ kind: 'tool_calls', content: options?.content ?? '', calls });
        return builder;
      },
      reply: (content) => {
        turns.push({ kind: 'reply', content });
        return this;
      },
    };

    return builder;
  }

  reset(): void {
    this.scripts.clear();
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.assertNotAborted(request);
    return this.resolveRound(request);
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.assertNotAborted(request);
    const response = this.resolveRound(request);

    for (const token of this.tokenize(response.content)) {
      yield { type: 'token', text: token };
    }

    yield { type: 'response', response };
  }

  /** Real adapters must honor the signal, so the mock does too. */
  private assertNotAborted(request: ModelRequest): void {
    if (request.signal?.aborted) {
      throw Object.assign(new Error('MockModelAdapter: request aborted.'), {
        name: 'AbortError',
      });
    }
  }

  private resolveRound(request: ModelRequest): ModelResponse {
    const turns = this.scripts.get(this.currentUserMessage(request)) ?? [];
    const turnIndex = request.messages.filter((m) => m.role === 'assistant').length;
    const turn = turns[turnIndex];

    if (!turn) {
      return this.finalResponse(this.defaultContent(request, turns.length > 0));
    }

    if (turn.kind === 'reply') {
      return this.finalResponse(turn.content);
    }

    return {
      content: turn.content,
      toolCalls: turn.calls.map((call, index) => this.toToolCall(call, turnIndex, index)),
      finishReason: 'tool_calls',
      usage: this.usagePerRound,
    };
  }

  private toToolCall(call: ScriptedToolCall, turnIndex: number, index: number): ModelToolCall {
    return {
      id: call.id ?? `mock_call_${turnIndex}_${index}`,
      name: call.name,
      args: call.args ?? {},
    };
  }

  private finalResponse(content: string): ModelResponse {
    return { content, toolCalls: [], finishReason: 'stop', usage: this.usagePerRound };
  }

  private defaultContent(request: ModelRequest, scripted: boolean): string {
    const message = this.currentUserMessage(request);
    return scripted
      ? `Mock completed tool execution for: "${message}"`
      : `Mock response: "${message}"`;
  }

  private currentUserMessage(request: ModelRequest): string {
    for (let i = request.messages.length - 1; i >= 0; i--) {
      const message = request.messages[i];
      if (message.role === 'user') return message.content;
    }
    return '';
  }

  private tokenize(content: string): string[] {
    if (!content) return [];
    return content.split(/(\s+)/).filter((part) => part.length > 0);
  }
}
