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
  private readonly client: OpenAI;
  private readonly options: OpenAiModelAdapterOptions;
  private readonly includeStreamUsage: boolean;

  constructor(@Optional() options?: OpenAiModelAdapterOptions) {
    this.options = options ?? {};
    this.includeStreamUsage = this.options.includeStreamUsage ?? true;
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

      return {
        content: choice?.message?.content ?? '',
        toolCalls: toModelToolCalls(choice?.message?.tool_calls),
        usage: toModelUsage(completion.usage),
        finishReason: toModelFinishReason(choice?.finish_reason),
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

        accumulator.add(choice.delta?.tool_calls);
      }
    } catch (err) {
      throw OpenAiModelError.from(err, request.model.model);
    }

    const toolCalls = accumulator.toModelToolCalls();

    yield {
      type: 'response',
      response: {
        content,
        toolCalls,
        usage,
        finishReason: toModelFinishReason(
          finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
        ),
      },
    };
  }

  private buildBaseParams(request: ModelRequest) {
    const tools = toOpenAiTools(request.tools);

    return {
      ...this.options.extraBody,
      model: request.model.model,
      messages: toOpenAiMessages(request.messages),
      ...(tools.length > 0 ? { tools } : {}),
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
