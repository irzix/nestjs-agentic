import type { ModelConfig } from './runtime.interface';
import type { Provenance } from './provenance.interface';
import type { ToolParamSchema } from './tool.interface';
import type { JsonSchema } from './structured-output.interface';

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
  | {
      role: 'tool';
      toolCallId: string;
      toolName: string;
      content: string;
      /**
       * Provenance label for the tool output carried in `content`. Additive and
       * provider-inert (adapters forward only `content`); lets policies, audit
       * sinks, and observers reason about the trust of a tool message.
       */
      provenance?: Provenance;
    };

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

/**
 * Asks the provider to constrain the final answer to a JSON Schema.
 *
 * Set by the executor when a turn has an `outputSchema`. Adapters that declare
 * `supportsStructuredOutput` forward it to the provider's native mechanism;
 * others may ignore it, since the executor validates the answer regardless.
 */
export interface ModelOutputFormat {
  type: 'json_schema';
  /** Provider-facing name for the schema. */
  name: string;
  schema: JsonSchema;
  description?: string;
  /** Request strict, schema-constrained decoding where the provider supports it. */
  strict: boolean;
}

export interface ModelRequest {
  model: ModelConfig;
  messages: ModelMessage[];
  tools: ModelToolSchema[];
  /** Requested shape of the final answer, when the turn has an `outputSchema`. */
  outputFormat?: ModelOutputFormat;
  /** Cancellation signal owned by the executor. Adapters should honor it. */
  signal?: AbortSignal;
  metadata: ModelRequestMetadata;
}

export interface ModelResponse {
  content: string;
  toolCalls?: ModelToolCall[];
  usage?: ModelUsage;
  finishReason?: ModelFinishReason;
  [key: string]: unknown;
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
  /**
   * Set `true` when the adapter forwards `ModelRequest.outputFormat` to the
   * provider's native structured-output support. Otherwise the executor also
   * describes the schema in the instructions it sends.
   */
  readonly supportsStructuredOutput?: boolean;
  generate(request: ModelRequest): Promise<ModelResponse>;
  /**
   * Optional token streaming. Implementations must finish by yielding a
   * `response` chunk carrying the complete round, including any tool calls.
   */
  stream?(request: ModelRequest): AsyncIterable<ModelStreamChunk>;
}
