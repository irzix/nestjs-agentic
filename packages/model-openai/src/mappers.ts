import type {
  ModelFinishReason,
  ModelMessage,
  ModelToolCall,
  ModelToolSchema,
  ModelUsage,
} from '@nestjs-agentic/core';
import type { CompletionUsage } from 'openai/resources/completions';
import type {
  ChatCompletionChunk,
  ChatCompletionFunctionTool,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';

/** Converts declared tool parameters into SDK function tool definitions. */
export function toOpenAiTools(tools: ModelToolSchema[]): ChatCompletionFunctionTool[] {
  return tools.map((tool) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const param of tool.parameters) {
      properties[param.name] = toJsonSchemaProperty(param.type, param.description);
      if (param.required) {
        required.push(param.name);
      }
    }

    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
      },
    };
  });
}

function toJsonSchemaProperty(
  type: ModelToolSchema['parameters'][number]['type'],
  description?: string,
): Record<string, unknown> {
  const base = description ? { description } : {};

  // JSON Schema requires `items` for arrays. The framework parameter schema does
  // not describe element types, so an unconstrained item schema is emitted.
  if (type === 'array') {
    return { ...base, type: 'array', items: {} };
  }
  return { ...base, type };
}

/** Converts framework conversation messages into SDK message params. */
export function toOpenAiMessages(messages: ModelMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message): ChatCompletionMessageParam => {
    switch (message.role) {
      case 'system':
        return { role: 'system', content: message.content };

      case 'user':
        return { role: 'user', content: message.content };

      case 'assistant':
        return {
          role: 'assistant',
          // The API rejects an empty string alongside tool calls.
          content: message.content ? message.content : null,
          ...(message.toolCalls?.length
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: 'function' as const,
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.args ?? {}),
                  },
                })),
              }
            : {}),
        };

      case 'tool':
        return {
          role: 'tool',
          tool_call_id: message.toolCallId,
          content: message.content,
        };
    }
  });
}

/**
 * Converts SDK tool calls into framework tool calls.
 *
 * Arguments arrive as a JSON string. Malformed payloads become an empty object
 * so the executor's argument validation reports the problem back to the model
 * instead of failing the whole turn. Custom (non-function) tool calls are
 * ignored because the framework only exposes function tools.
 */
export function toModelToolCalls(
  toolCalls: ChatCompletionMessageToolCall[] | undefined,
): ModelToolCall[] {
  if (!toolCalls?.length) return [];

  return toolCalls
    .filter((call) => call.type === 'function')
    .map((call, index) => ({
      id: call.id ?? `tool_call_${index}`,
      name: call.function.name,
      args: parseArguments(call.function.arguments),
    }));
}

export function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw || raw.trim() === '') return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function toModelUsage(usage: CompletionUsage | undefined | null): ModelUsage | undefined {
  if (!usage) return undefined;

  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

export function toModelFinishReason(reason: string | null | undefined): ModelFinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'unknown';
  }
}

/**
 * Merges streamed tool-call deltas, which arrive as fragments identified by
 * index with names and argument text split across chunks.
 */
export class ToolCallAccumulator {
  private readonly byIndex = new Map<number, { id?: string; name: string; arguments: string }>();

  add(deltas: ChatCompletionChunk.Choice.Delta.ToolCall[] | undefined): void {
    if (!deltas?.length) return;

    for (const [position, delta] of deltas.entries()) {
      const index = delta.index ?? position;
      const existing = this.byIndex.get(index) ?? { name: '', arguments: '' };

      this.byIndex.set(index, {
        id: delta.id ?? existing.id,
        name: delta.function?.name ?? existing.name,
        arguments: existing.arguments + (delta.function?.arguments ?? ''),
      });
    }
  }

  toModelToolCalls(): ModelToolCall[] {
    return [...this.byIndex.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, call]) => call.name !== '')
      .map(([index, call]) => ({
        id: call.id ?? `tool_call_${index}`,
        name: call.name,
        args: parseArguments(call.arguments),
      }));
  }

  get size(): number {
    return this.byIndex.size;
  }
}
