import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ExecutionCancelledError,
  ExecutionLimitExceededError,
  RuntimeNotConfiguredError,
  ToolValidationError,
} from '../errors';
import {
  DEFAULT_EXECUTION_LIMITS,
  type ExecutionLimitKind,
  type ExecutionLimits,
} from '../interfaces/execution.interface';
import {
  MODEL_ADAPTER,
  type ModelAdapter,
  type ModelMessage,
  type ModelRequest,
  type ModelResponse,
  type ModelToolCall,
  type ModelToolSchema,
  type ModelUsage,
} from '../interfaces/model.interface';
import type { AgentResult, ModelConfig } from '../interfaces/runtime.interface';
import type { AgentStreamEvent } from '../interfaces/agent-stream.interface';
import type {
  ResolvedTool,
  ToolCallRecord,
  ToolExecutionResult,
} from '../interfaces/tool.interface';
import { validateToolArgs } from '../utils/tool-args.validator';

/** Input for one governed agent turn executed by the framework runtime. */
export interface AgentExecutionInput {
  sessionId: string;
  message: string;
  model: ModelConfig;
  tools: ResolvedTool[];
  instructions?: string;
  traceId?: string;
  /** Prior conversation messages to replay before the current user message. */
  history?: ModelMessage[];
  limits?: ExecutionLimits;
  signal?: AbortSignal;
}

interface ExecutionState {
  executionId: string;
  messages: ModelMessage[];
  toolCalls: ToolCallRecord[];
  usage: ModelUsage;
  toolCallCount: number;
  iteration: number;
  suspended: boolean;
}

/**
 * The framework-owned agent loop.
 *
 * AgentExecutor drives model rounds and governed tool execution so behavior does
 * not depend on a provider SDK or an external orchestration framework:
 *
 * 1. Sends instructions, history, and the user message to the ModelAdapter.
 * 2. Validates any requested tool arguments against declared parameters.
 * 3. Invokes the matching ResolvedTool, which enforces policies and approvals.
 * 4. Feeds tool results back to the model until it produces a final answer.
 *
 * Every turn is bounded by iteration, tool-call, token, and time budgets, and
 * honors cancellation through an AbortSignal.
 */
@Injectable()
export class AgentExecutor {
  constructor(
    @Optional() @Inject(MODEL_ADAPTER) private readonly modelAdapter?: ModelAdapter,
  ) {}

  /** Whether a ModelAdapter is registered and the built-in runtime can be used. */
  isAvailable(): boolean {
    return Boolean(this.modelAdapter);
  }

  async execute(input: AgentExecutionInput): Promise<AgentResult> {
    const adapter = this.requireAdapter();
    const limits = this.resolveLimits(input.limits);
    const state = this.createState(input);
    const scope = this.createScope(input.signal, limits.timeoutMs);

    try {
      while (true) {
        this.assertWithinBudget(state, limits, scope);

        const response = await adapter.generate(this.buildRequest(input, state, scope));
        const finished = await this.applyModelRound(state, response, input.tools, limits, scope);

        if (finished) {
          return this.toResult(input.sessionId, state, response.content);
        }
      }
    } finally {
      scope.dispose();
    }
  }

  async *stream(input: AgentExecutionInput): AsyncIterable<AgentStreamEvent> {
    const adapter = this.requireAdapter();
    const limits = this.resolveLimits(input.limits);
    const state = this.createState(input);
    const scope = this.createScope(input.signal, limits.timeoutMs);

    try {
      while (true) {
        this.assertWithinBudget(state, limits, scope);

        const request = this.buildRequest(input, state, scope);
        let response: ModelResponse | undefined;

        if (adapter.stream) {
          for await (const chunk of adapter.stream(request)) {
            if (chunk.type === 'token') {
              if (chunk.text) yield { type: 'token', text: chunk.text };
              continue;
            }
            response = chunk.response;
          }

          if (!response) {
            throw new Error(
              'ModelAdapter.stream() completed without emitting a final "response" chunk.',
            );
          }
        } else {
          response = await adapter.generate(request);
          if (response.content) {
            yield { type: 'token', text: response.content };
          }
        }

        const pendingEvents: AgentStreamEvent[] = [];
        const finished = await this.applyModelRound(
          state,
          response,
          input.tools,
          limits,
          scope,
          pendingEvents,
        );

        for (const event of pendingEvents) {
          yield event;
        }

        if (finished) {
          yield {
            type: 'complete',
            sessionId: input.sessionId,
            output: this.resolveOutput(state, response.content),
          };
          return;
        }
      }
    } finally {
      scope.dispose();
    }
  }

  private requireAdapter(): ModelAdapter {
    if (!this.modelAdapter) {
      throw new RuntimeNotConfiguredError();
    }
    return this.modelAdapter;
  }

  private createState(input: AgentExecutionInput): ExecutionState {
    const messages: ModelMessage[] = [];

    if (input.instructions) {
      messages.push({ role: 'system', content: input.instructions });
    }
    if (input.history?.length) {
      messages.push(...input.history);
    }
    messages.push({ role: 'user', content: input.message });

    return {
      executionId: randomUUID(),
      messages,
      toolCalls: [],
      usage: {},
      toolCallCount: 0,
      iteration: 0,
      suspended: false,
    };
  }

  private resolveLimits(limits?: ExecutionLimits): ExecutionLimits {
    return {
      maxIterations: limits?.maxIterations ?? DEFAULT_EXECUTION_LIMITS.maxIterations,
      maxToolCalls: limits?.maxToolCalls ?? DEFAULT_EXECUTION_LIMITS.maxToolCalls,
      timeoutMs: limits?.timeoutMs,
      maxTotalTokens: limits?.maxTotalTokens,
    };
  }

  /**
   * Links the caller signal with an optional timeout so a single signal can be
   * forwarded to model adapters and inspected by the loop.
   */
  private createScope(
    signal: AbortSignal | undefined,
    timeoutMs: number | undefined,
  ): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const abortFromCaller = () => controller.abort();

    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', abortFromCaller, { once: true });
      }
    }

    if (timeoutMs !== undefined && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }

    return {
      signal: controller.signal,
      timedOut: () => timedOut,
      dispose: () => {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', abortFromCaller);
      },
    };
  }

  private assertWithinBudget(
    state: ExecutionState,
    limits: ExecutionLimits,
    scope: { signal: AbortSignal; timedOut: () => boolean },
  ): void {
    this.assertNotAborted(scope, limits);

    if (limits.maxIterations !== undefined && state.iteration >= limits.maxIterations) {
      throw new ExecutionLimitExceededError('max_iterations', limits.maxIterations);
    }

    if (
      limits.maxTotalTokens !== undefined &&
      (state.usage.totalTokens ?? 0) >= limits.maxTotalTokens
    ) {
      throw new ExecutionLimitExceededError('max_total_tokens', limits.maxTotalTokens);
    }
  }

  private assertNotAborted(
    scope: { signal: AbortSignal; timedOut: () => boolean },
    limits: ExecutionLimits,
  ): void {
    if (!scope.signal.aborted) return;

    if (scope.timedOut()) {
      throw new ExecutionLimitExceededError('timeout', limits.timeoutMs ?? 0);
    }
    throw new ExecutionCancelledError();
  }

  private buildRequest(
    input: AgentExecutionInput,
    state: ExecutionState,
    scope: { signal: AbortSignal },
  ): ModelRequest {
    return {
      model: input.model,
      messages: [...state.messages],
      tools: this.toToolSchemas(input.tools),
      signal: scope.signal,
      metadata: {
        sessionId: input.sessionId,
        traceId: input.traceId ?? state.executionId,
        executionId: state.executionId,
        iteration: state.iteration,
      },
    };
  }

  private toToolSchemas(tools: ResolvedTool[]): ModelToolSchema[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /**
   * Records one model round and executes any requested tools.
   * Returns true when the turn is complete, either because the model produced a
   * final answer or because a tool requires human approval.
   */
  private async applyModelRound(
    state: ExecutionState,
    response: ModelResponse,
    tools: ResolvedTool[],
    limits: ExecutionLimits,
    scope: { signal: AbortSignal; timedOut: () => boolean },
    events?: AgentStreamEvent[],
  ): Promise<boolean> {
    state.iteration++;
    this.accumulateUsage(state, response.usage);

    const requestedCalls = response.toolCalls ?? [];
    if (requestedCalls.length === 0) {
      return true;
    }

    state.messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: requestedCalls,
    });

    for (const call of requestedCalls) {
      this.assertNotAborted(scope, limits);

      if (limits.maxToolCalls !== undefined && state.toolCallCount >= limits.maxToolCalls) {
        throw new ExecutionLimitExceededError('max_tool_calls', limits.maxToolCalls);
      }
      state.toolCallCount++;

      const tool = tools.find((candidate) => candidate.name === call.name);
      if (!tool) {
        this.pushToolMessage(state, call, {
          error: `Unknown tool "${call.name}". Available tools: ${tools
            .map((t) => t.name)
            .join(', ')}`,
        });
        continue;
      }

      const validation = validateToolArgs(tool.parameters, call.args);
      if (!validation.valid) {
        const error = new ToolValidationError(tool.name, validation.issues);
        this.pushToolMessage(state, call, { error: error.message });
        continue;
      }

      events?.push({
        type: 'tool_start',
        id: call.id,
        toolName: tool.name,
        args: validation.args,
      });

      const result = await tool.execute({ args: validation.args });
      state.toolCalls.push({ toolName: tool.name, args: validation.args, result });
      this.pushToolMessage(state, call, result);

      if (!result.success && result.status === 'pending_approval') {
        events?.push({
          type: 'approval_required',
          id: call.id,
          toolName: tool.name,
          approvalId: result.approvalId,
          reason: result.reason,
        });
        state.suspended = true;
        return true;
      }

      events?.push({ type: 'tool_result', id: call.id, toolName: tool.name, result });
    }

    return false;
  }

  private accumulateUsage(state: ExecutionState, usage?: ModelUsage): void {
    if (!usage) return;

    const add = (current: number | undefined, next: number | undefined) =>
      next === undefined ? current : (current ?? 0) + next;

    state.usage = {
      inputTokens: add(state.usage.inputTokens, usage.inputTokens),
      outputTokens: add(state.usage.outputTokens, usage.outputTokens),
      totalTokens: add(
        state.usage.totalTokens,
        usage.totalTokens ?? add(usage.inputTokens, usage.outputTokens),
      ),
    };
  }

  private pushToolMessage(
    state: ExecutionState,
    call: ModelToolCall,
    payload: ToolExecutionResult | { error: string },
  ): void {
    state.messages.push({
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content: JSON.stringify(payload),
    });
  }

  private toResult(
    sessionId: string,
    state: ExecutionState,
    content: string,
  ): AgentResult {
    return {
      sessionId,
      output: this.resolveOutput(state, content),
      toolCalls: state.toolCalls,
    };
  }

  /**
   * Suspended turns may have no model text, so approval requests surface a
   * deterministic message instead of an empty output.
   */
  private resolveOutput(state: ExecutionState, content: string): string {
    if (!state.suspended || content) {
      return content;
    }

    const pending = state.toolCalls[state.toolCalls.length - 1];
    const result = pending?.result as ToolExecutionResult | undefined;

    if (result && !result.success && result.status === 'pending_approval') {
      return `Tool "${pending.toolName}" requires approval (${result.approvalId}): ${result.reason}`;
    }
    return content;
  }
}

/** @internal exported for framework tests. */
export type { ExecutionLimitKind };
