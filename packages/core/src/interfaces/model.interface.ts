import type { ModelConfig } from './runtime.interface';
import type { ToolParamSchema } from './tool.interface';

/**
 * Injection token for the ModelAdapter implementation.
 *
 * When a ModelAdapter is registered, AgentRunner executes agents through the
 * framework-owned AgentExecutor loop instead of delegating the whole turn to a
 * RuntimeAdapter.
 *
 * @example { provide: MODEL_ADAPTER, useClass: OpenAiModelAdapter }
 */
export const MODEL_ADAPTER = Symbol('MODEL_ADAPTER');

/** Tool definition passed to a model provider, free of NestJS specifics. */
export interface ModelToolSchema {
  name: string;
  description: string;
  parameters: ToolParamSchema[];
}

/** A tool invocation requested by the model. */
export interface ModelToolCall {
  /** Provider-supplied identifier, used to correlate the matching tool result. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * Conversation entry exchanged with a model provider.
 * Framework-owned so adapters translate to and from provider payloads.
 */
export type ModelMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ModelToolCall[] }
  | { role: 'tool'; toolCallId: string; toolName: string; content: string };

/** Token accounting reported by a provider, when available. */
export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** Why the model stopped producing output. */
export type ModelFinishReason =
  | 'stop'
  | 'tool_calls'
  | 'length'
  | 'content_filter'
  | 'unknown';

/** Execution identity forwarded to adapters for tracing and provider metadata. */
export interface ModelRequestMetadata {
  sessionId: string;
  traceId: string;
  executionId: string;
  /** Zero-based index of the current model round within one agent turn. */
  iteration: number;
}

export interface ModelRequest {
  model: ModelConfig;
  messages: ModelMessage[];
  tools: ModelToolSchema[];
  /** Cancellation signal owned by the executor. Adapters should honor it. */
  signal?: AbortSignal;
  metadata: ModelRequestMetadata;
}

export interface ModelResponse {
  content: string;
  toolCalls?: ModelToolCall[];
  usage?: ModelUsage;
  finishReason?: ModelFinishReason;
}

/** Incremental output emitted by adapters that support streaming. */
export type ModelStreamChunk =
  | { type: 'token'; text: string }
  | { type: 'response'; response: ModelResponse };

/**
 * Provider-neutral contract for a single model round.
 *
 * A ModelAdapter is responsible only for talking to a provider. It does not
 * execute tools, enforce policies, or manage the agent loop.
 */
export interface ModelAdapter {
  generate(request: ModelRequest): Promise<ModelResponse>;
  /**
   * Optional token streaming. Implementations must finish by yielding a
   * `response` chunk carrying the complete round, including any tool calls.
   */
  stream?(request: ModelRequest): AsyncIterable<ModelStreamChunk>;
}
