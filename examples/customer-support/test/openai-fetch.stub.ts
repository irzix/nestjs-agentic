/**
 * Minimal scripted OpenAI endpoint used to run the example deterministically
 * without network access. Responses are returned in the order they are queued,
 * so each entry represents one model round.
 */

export interface ScriptedToolCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

export interface RecordedRequest {
  url: string;
  body: any;
}

export class ScriptedOpenAi {
  private readonly rounds: Array<() => Response> = [];
  readonly requests: RecordedRequest[] = [];

  /** Queues a round in which the model requests tools. */
  callTools(calls: ScriptedToolCall[], content = ''): this {
    this.rounds.push(() =>
      jsonResponse({
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: content || null,
              tool_calls: calls.map((call, index) => ({
                id: call.id ?? `call_${index}`,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            },
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      }),
    );
    return this;
  }

  /** Queues a final round in which the model answers. */
  reply(content: string): this {
    this.rounds.push(() =>
      jsonResponse({
        choices: [
          { index: 0, finish_reason: 'stop', message: { role: 'assistant', content } },
        ],
        usage: { prompt_tokens: 25, completion_tokens: 10, total_tokens: 35 },
      }),
    );
    return this;
  }

  /** Queues a streaming round emitting content tokens then optional tool calls. */
  streamReply(tokens: string[], calls: ScriptedToolCall[] = []): this {
    const frames: string[] = tokens.map(
      (text) =>
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`,
    );

    calls.forEach((call, index) => {
      frames.push(
        `data: ${JSON.stringify({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index,
                    id: call.id ?? `call_stream_${index}`,
                    type: 'function',
                    function: { name: call.name, arguments: JSON.stringify(call.args) },
                  },
                ],
              },
            },
          ],
        })}\n\n`,
      );
    });

    frames.push(
      `data: ${JSON.stringify({
        choices: [
          { index: 0, finish_reason: calls.length > 0 ? 'tool_calls' : 'stop', delta: {} },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      })}\n\n`,
      'data: [DONE]\n\n',
    );

    this.rounds.push(() => sseResponse(frames));
    return this;
  }

  /** Fetch implementation to inject into the OpenAI SDK client. */
  get fetch() {
    let index = 0;

    return async (input: any, init?: any): Promise<Response> => {
      this.requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      const round = this.rounds[index];
      index++;

      if (!round) {
        throw new Error(
          `ScriptedOpenAi received ${index} requests but only ${this.rounds.length} rounds were queued.`,
        );
      }
      return round();
    };
  }

  /** Tool names requested across all recorded rounds, in call order. */
  get requestedTools(): string[] {
    return this.requests.flatMap((request) =>
      (request.body?.tools ?? []).map((tool: any) => tool.function.name),
    );
  }
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

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
