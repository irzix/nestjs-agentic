import { Injectable, Optional } from '@nestjs/common';
import type {
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  ModelStreamChunk,
} from '@nestjs-agentic/core';
import OpenAI from 'openai';
import type { ClientOptions } from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { OpenAiModelError } from './errors';
import {
  ToolCallAccumulator,
  toModelFinishReason,
  toModelToolCalls,
  toModelUsage,
  toOpenAiMessages,
  toOpenAiTools,
} from './mappers';

export interface OpenAiModelAdapterOptions {
  /** API key. Defaults to the SDK behavior of reading `OPENAI_API_KEY`. */
  apiKey?: string;
  /**
   * Base URL of any Chat Completions compatible API.
   *
   * @example 'http://localhost:11434/v1'   // Ollama
   * @example 'http://localhost:8000/v1'    // vLLM
   * @example 'https://openrouter.ai/api/v1'
   */
  baseUrl?: string;
  /** Additional headers merged into every request. */
  headers?: Record<string, string>;
  /** Per-request timeout in milliseconds, applied by the SDK. */
  timeoutMs?: number;
  /** SDK retry count for transient failures such as 429 and 5xx. Default: 2 */
  maxRetries?: number;
  /** Sampling temperature forwarded to the provider. */
  temperature?: number;
  /** Nucleus sampling value forwarded to the provider. */
  topP?: number;
  /** Token cap for classic chat models. */
  maxTokens?: number;
  /**
   * Token cap for reasoning models, which reject `max_tokens`.
   * Takes precedence over `maxTokens` when both are set.
   */
  maxCompletionTokens?: number;
  /** Whether to request usage in the final streaming chunk. Default: true */
  includeStreamUsage?: boolean;
  /** Extra body fields merged into every request payload. */
  extraBody?: Record<string, unknown>;
  /**
   * How an agent's `outputSchema` reaches the model.
   *
   * - `'native'` (default): sent as `response_format: { type: 'json_schema' }`.
   * - `'prompt'`: not sent as a parameter, so the core runtime describes the
   *   schema in the prompt instead. Use it for compatible servers or models
   *   that reject or ignore `json_schema` response formats.
   *
   * Either way the core runtime validates and repairs the answer.
   */
  structuredOutput?: 'native' | 'prompt';
  /**
   * Pre-configured SDK client. Use this for Azure via `AzureOpenAI`, custom
   * transports, proxies, or deterministic tests.
   * When provided, connection options above are ignored.
   */
  client?: OpenAI;
  /** Additional SDK client options merged when constructing the client. */
  clientOptions?: ClientOptions;
}

/**
 * ModelAdapter backed by the official OpenAI SDK.
 *
 * Works with OpenAI and any API implementing the Chat Completions shape, such
 * as Azure OpenAI, Ollama, vLLM, Groq, Together, OpenRouter, and LM Studio.
 *
 * The adapter performs only provider communication. Tool execution, policy
 * evaluation, argument validation, budgets, and loop control remain in
 * `AgentExecutor`.
 *
 * @example
 * AgenticModule.forRoot({
 *   defaultModel: { provider: 'openai', model: 'gpt-4o-mini' },
 *   modelAdapter: new OpenAiModelAdapter({ apiKey: process.env.OPENAI_API_KEY }),
 * });
 */
@Injectable()
export class OpenAiModelAdapter implements ModelAdapter {
  /**
   * Whether `outputFormat` is sent as `response_format: { type: 'json_schema' }`,
   * per the `structuredOutput` option.
   */
  readonly supportsStructuredOutput: boolean;
  private readonly client: OpenAI;
  private readonly options: OpenAiModelAdapterOptions;
  private readonly includeStreamUsage: boolean;

  constructor(@Optional() options?: OpenAiModelAdapterOptions) {
    this.options = options ?? {};
    this.includeStreamUsage = this.options.includeStreamUsage ?? true;
    this.supportsStructuredOutput = (this.options.structuredOutput ?? 'native') === 'native';
    this.client = this.options.client ?? this.createClient(this.options);
  }

  private createClient(options: OpenAiModelAdapterOptions): OpenAI {
    return new OpenAI({
      ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
      ...(options.baseUrl !== undefined ? { baseURL: options.baseUrl } : {}),
      ...(options.headers ? { defaultHeaders: options.headers } : {}),
      ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
      maxRetries: options.maxRetries ?? 2,
      ...options.clientOptions,
    });
  }

  /** Exposes the underlying SDK client for provider features outside this contract. */
  getClient(): OpenAI {
    return this.client;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const params: ChatCompletionCreateParamsNonStreaming = {
      ...this.buildBaseParams(request),
      stream: false,
    };

    try {
      const completion = await this.client.chat.completions.create(params, {
        signal: request.signal,
      });

      const choice = completion.choices?.[0];
      const refusal = choice?.message?.refusal;

      return {
        content: unwrapStructuredContent(request, choice?.message?.content ?? '', this.supportsStructuredOutput),
        toolCalls: toModelToolCalls(choice?.message?.tool_calls),
        usage: toModelUsage(completion.usage),
        finishReason: toModelFinishReason(choice?.finish_reason),
        ...(refusal ? { refusal } : {}),
      };
    } catch (err) {
      throw OpenAiModelError.from(err, request.model.model);
    }
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const params: ChatCompletionCreateParamsStreaming = {
      ...this.buildBaseParams(request),
      stream: true,
      ...(this.includeStreamUsage ? { stream_options: { include_usage: true } } : {}),
    };

    const accumulator = new ToolCallAccumulator();
    let content = '';
    let refusal = '';
    let finishReason: string | null | undefined;
    let usage: ModelResponse['usage'];

    try {
      const stream = await this.client.chat.completions.create(params, {
        signal: request.signal,
      });

      for await (const chunk of stream) {
        if (chunk.usage) {
          usage = toModelUsage(chunk.usage);
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        const text = choice.delta?.content;
        if (text) {
          content += text;
          yield { type: 'token', text };
        }
        const refused = (choice.delta as { refusal?: string | null } | undefined)?.refusal;
        if (refused) {
          refusal += refused;
        }

        accumulator.add(choice.delta?.tool_calls);
      }
    } catch (err) {
      throw OpenAiModelError.from(err, request.model.model);
    }

    const toolCalls = accumulator.toModelToolCalls();

    yield {
      type: 'response',
      response: {
        content: unwrapStructuredContent(request, content, this.supportsStructuredOutput),
        toolCalls,
        usage,
        ...(refusal ? { refusal } : {}),
        finishReason: toModelFinishReason(
          finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
        ),
      },
    };
  }

  private buildBaseParams(request: ModelRequest) {
    const tools = toOpenAiTools(request.tools);
    const format = this.supportsStructuredOutput ? request.outputFormat : undefined;
    const schema = format && (needsWrapping(format.schema) ? wrapSchema(format.schema) : format.schema);

    return {
      ...this.options.extraBody,
      model: request.model.model,
      messages: toOpenAiMessages(request.messages),
      ...(tools.length > 0 ? { tools } : {}),
      ...(format && schema
        ? {
            response_format: {
              type: 'json_schema' as const,
              json_schema: {
                name: format.name,
                schema,
                // Strict mode rejects schemas outside its subset with a 400, so
                // those are sent non-strict; the core runtime validates either way.
                strict: format.strict && isStrictCompatible(schema),
                ...(format.description !== undefined ? { description: format.description } : {}),
              },
            },
          }
        : {}),
      ...(this.options.temperature !== undefined
        ? { temperature: this.options.temperature }
        : {}),
      ...(this.options.topP !== undefined ? { top_p: this.options.topP } : {}),
      // Reasoning models reject max_tokens, so max_completion_tokens wins.
      ...(this.options.maxCompletionTokens !== undefined
        ? { max_completion_tokens: this.options.maxCompletionTokens }
        : this.options.maxTokens !== undefined
          ? { max_tokens: this.options.maxTokens }
          : {}),
    };
  }
}

/**
 * OpenAI accepts only an object at the root of a `json_schema` response
 * format. Any other root (an array, a string) is sent wrapped as the
 * `value` property of an object, and unwrapped again in the response.
 */
function needsWrapping(schema: Record<string, unknown>): boolean {
  return schema.type !== 'object';
}

function wrapSchema(schema: Record<string, unknown>): Record<string, unknown> {
  // Definitions move to the new root, so `#/$defs/...` and `#/definitions/...`
  // references keep their targets.
  const { $defs, definitions, ...inner } = schema;
  const wrapper = (value: unknown, defs: unknown, legacyDefs: unknown) => ({
    type: 'object',
    properties: { value },
    required: ['value'],
    additionalProperties: false,
    ...(defs !== undefined ? { $defs: defs } : {}),
    ...(legacyDefs !== undefined ? { definitions: legacyDefs } : {}),
  });

  // Any other local reference (`#` for root recursion, `#/items/...`) pointed
  // into the original root. The root then moves into `$defs` too, and those
  // references are re-pointed at it.
  let moved = false;
  const rootKey = uniqueKey('wrapped_root', $defs);
  const moveRef = (ref: string): string => {
    if (ref !== '#' && !ref.startsWith('#/')) return ref;
    if (ref.startsWith('#/$defs/') || ref.startsWith('#/definitions/')) return ref;
    moved = true;
    return `#/$defs/${rootKey}${ref.slice(1)}`;
  };
  const movedInner = rewriteRefs(inner, moveRef);
  const movedDefs = $defs !== undefined ? rewriteRefs($defs, moveRef) : undefined;
  const movedDefinitions = definitions !== undefined ? rewriteRefs(definitions, moveRef) : undefined;
  if (!moved) return wrapper(inner, $defs, definitions);
  return wrapper(
    { $ref: `#/$defs/${rootKey}` },
    { ...(isRecord(movedDefs) ? movedDefs : {}), [rootKey]: movedInner },
    movedDefinitions,
  );
}

/** Keywords whose values are data, not subschemas, so a `$ref` key inside them is not a reference. */
const DATA_KEYWORDS = new Set(['const', 'enum', 'default', 'examples']);
/** Keywords whose values map names to subschemas. */
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Copies a schema with every `$ref` passed through `map`. */
function rewriteRefs(node: unknown, map: (ref: string) => string): unknown {
  if (Array.isArray(node)) return node.map((item) => rewriteRefs(item, map));
  if (!isRecord(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') out[key] = map(value);
    else if (DATA_KEYWORDS.has(key)) out[key] = value;
    else if (SCHEMA_MAPS.has(key) && isRecord(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, rewriteRefs(sub, map)]));
    } else out[key] = rewriteRefs(value, map);
  }
  return out;
}

function uniqueKey(base: string, taken: unknown): string {
  const keys = isRecord(taken) ? taken : {};
  let key = base;
  for (let n = 2; key in keys; n++) key = `${base}_${n}`;
  return key;
}

/** Subschema-valued keywords that strict mode's object rules reach through. */
const SUBSCHEMA_KEYWORDS = ['items', 'prefixItems', 'anyOf', 'oneOf', 'allOf', 'not', 'additionalProperties', 'contains', 'if', 'then', 'else'];

/**
 * Whether OpenAI's strict mode accepts the schema's objects: each must set
 * `additionalProperties: false` and list every property in `required`.
 * Checked through properties, items, combinators, and definitions.
 */
function isStrictCompatible(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(isStrictCompatible);
  if (!isRecord(node)) return true;
  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes('object') || isRecord(node.properties)) {
    if (node.additionalProperties !== false) return false;
    const required = Array.isArray(node.required) ? node.required : [];
    if (isRecord(node.properties) && !Object.keys(node.properties).every((name) => required.includes(name))) return false;
  }
  for (const key of SCHEMA_MAPS) {
    const map = node[key];
    if (isRecord(map) && !Object.values(map).every(isStrictCompatible)) return false;
  }
  return SUBSCHEMA_KEYWORDS.every((key) => isStrictCompatible(node[key]));
}

/** Undoes `wrapSchema` on the model's answer. Anything else passes through. */
function unwrapStructuredContent(request: ModelRequest, content: string, native: boolean): string {
  const format = request.outputFormat;
  if (!native || !format || !needsWrapping(format.schema) || !content) return content;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'value' in parsed) {
      return JSON.stringify((parsed as { value: unknown }).value);
    }
  } catch {
    // Not the wrapped shape; the core runtime reports it.
  }
  return content;
}
