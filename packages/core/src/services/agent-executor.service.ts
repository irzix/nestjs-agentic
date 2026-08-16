import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AgenticError,
  ApprovalTranscriptMissingError,
  ExecutionCancelledError,
  ExecutionLimitExceededError,
  InFlightCheckpointVersionError,
  RuntimeNotConfiguredError,
  ToolValidationError,
} from '../errors';
import {
  DEFAULT_EXECUTION_LIMITS,
  DEFAULT_TOOL_ERROR_HANDLING,
  INFLIGHT_CHECKPOINT_VERSION,
  type ExecutionLimitKind,
  type ExecutionLimits,
  type InFlightCheckpoint,
  type ToolErrorHandling,
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
import type { AgentObserver } from '../interfaces/observer.interface';
import { ObserverNotifier } from '../observers/observer-notifier';

/** Input for one governed agent turn executed by the framework runtime. */
export interface AgentExecutionInput {
  sessionId: string;
  message: string;
  model: ModelConfig;
  tools: ResolvedTool[];
  agentName?: string;
  instructions?: string;
  traceId?: string;
  parentTraceId?: string;
  rootTraceId?: string;
  /** Prior conversation messages to replay before the current user message. */
  history?: ModelMessage[];
  limits?: ExecutionLimits;
  /** How exceptions thrown by tools are treated. Default: `report` */
  toolErrorHandling?: ToolErrorHandling;
  signal?: AbortSignal;
  observers?: AgentObserver[];
  observerNotifier?: ObserverNotifier;
  /**
   * Receives the conversation once the turn ends, either with a final answer or
   * suspended for approval. Not called when the turn fails, so a partial
   * transcript is never persisted.
   */
  onTranscript?(messages: ModelMessage[]): void | Promise<void>;
  /**
   * Receives the conversation at the moment a turn suspends for approval, so
   * the caller can checkpoint it against the approval record.
   *
   * The executor stays free of persistence concerns, exactly as with
   * `onTranscript`. This runs before the turn returns, so the checkpoint is
   * durable before the caller can learn the `approvalId` and settle it.
   */
  onSuspend?(approvalId: string, messages: ModelMessage[]): void | Promise<void>;
  /**
   * Receives an in-flight checkpoint after each model/tool iteration round,
   * enabling process restart recovery and mid-loop resumption.
   */
  onCheckpoint?(checkpoint: InFlightCheckpoint): void | Promise<void>;
}

/** Fields shared by a fresh turn and a resumed one. */
interface ExecutorRequestContext {
  sessionId: string;
  model: ModelConfig;
  tools: ResolvedTool[];
  agentName?: string;
  traceId?: string;
  parentTraceId?: string;
  rootTraceId?: string;
  signal?: AbortSignal;
  observerNotifier?: ObserverNotifier;
}

/** Input for continuing a turn that suspended on `require_approval`. */
export interface AgentResumeInput extends ExecutorRequestContext {
  instructions?: string;
  /**
   * Full prior transcript, including the suspended tool message that carried
   * the `pending_approval` payload. Typically loaded from `SessionStore`.
   */
  history: ModelMessage[];
  /** Identifies which suspended tool message to resolve. */
  toolCallId: string;
  /** Name of the tool the suspended call targeted, recorded on the result. */
  toolName: string;
  /** Original arguments the model requested, recorded on the result. */
  args: Record<string, unknown>;
  /** The resolved outcome to splice in place of the `pending_approval` payload. */
  outcome: ToolExecutionResult;
  limits?: ExecutionLimits;
  toolErrorHandling?: ToolErrorHandling;
  observers?: AgentObserver[];
  onTranscript?(messages: ModelMessage[]): void | Promise<void>;
  /** Checkpoints a resumed turn that suspends again on a further approval. */
  onSuspend?(approvalId: string, messages: ModelMessage[]): void | Promise<void>;
  onCheckpoint?(checkpoint: InFlightCheckpoint): void | Promise<void>;
}

/** Input for continuing a turn directly from an in-flight checkpoint snapshot. */
export interface AgentResumeCheckpointInput extends ExecutorRequestContext {
  checkpoint: InFlightCheckpoint;
  instructions?: string;
  limits?: ExecutionLimits;
  toolErrorHandling?: ToolErrorHandling;
  observers?: AgentObserver[];
  onTranscript?(messages: ModelMessage[]): void | Promise<void>;
  onSuspend?(approvalId: string, messages: ModelMessage[]): void | Promise<void>;
  onCheckpoint?(checkpoint: InFlightCheckpoint): void | Promise<void>;
}

/** Payload reported to the model, and recorded, when a tool throws. */
interface ToolFailurePayload {
  success: false;
  status: 'error';
  error: string;
}

/** Upper bound on a reported tool error message, which reaches the model. */
const MAX_TOOL_ERROR_LENGTH = 500;

interface ExecutionState {
  executionId: string;
  messages: ModelMessage[];
  toolCalls: ToolCallRecord[];
  usage: ModelUsage;
  toolCallCount: number;
  iteration: number;
  suspended: boolean;
  /** Identifies the approval that suspended this turn, for checkpointing. */
  suspendedApprovalId?: string;
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

  private createRequestContext(
    input: AgentExecutionInput | AgentResumeInput | AgentResumeCheckpointInput,
  ): ExecutorRequestContext {
    const observerNotifier =
      input.observerNotifier ??
      (input.observers?.length ? new ObserverNotifier(input.observers) : undefined);

    return {
      sessionId: input.sessionId,
      model: input.model,
      tools: input.tools,
      traceId: input.traceId,
      parentTraceId: (input as AgentExecutionInput).parentTraceId,
      rootTraceId: (input as AgentExecutionInput).rootTraceId,
      signal: input.signal,
      agentName: input.agentName,
      observerNotifier,
    };
  }

  async execute(input: AgentExecutionInput): Promise<AgentResult> {
    const adapter = this.requireAdapter();
    const limits = this.resolveLimits(input.limits);
    const toolErrorHandling = input.toolErrorHandling ?? DEFAULT_TOOL_ERROR_HANDLING;
    const state = this.createState(input);
    const requestCtx = this.createRequestContext(input);

    return this.runToCompletion(
      adapter,
      requestCtx,
      state,
      limits,
      toolErrorHandling,
      input.onTranscript,
      input.onSuspend,
      input.onCheckpoint,
    );
  }

  async *stream(input: AgentExecutionInput): AsyncIterable<AgentStreamEvent> {
    const adapter = this.requireAdapter();
    const limits = this.resolveLimits(input.limits);
    const toolErrorHandling = input.toolErrorHandling ?? DEFAULT_TOOL_ERROR_HANDLING;
    const state = this.createState(input);
    const requestCtx = this.createRequestContext(input);

    yield* this.streamToCompletion(
      adapter,
      requestCtx,
      state,
      limits,
      toolErrorHandling,
      input.onTranscript,
      input.onSuspend,
      input.onCheckpoint,
    );
  }

  /**
   * Continues a turn that suspended on `require_approval`.
   *
   * Splices the human decision into the exact tool message that was withheld,
   * then lets the model react to it the same way it would to any other tool
   * result, until it produces a final answer or suspends again.
   */
  async resume(input: AgentResumeInput): Promise<AgentResult> {
    const adapter = this.requireAdapter();
    const limits = this.resolveLimits(input.limits);
    const toolErrorHandling = input.toolErrorHandling ?? DEFAULT_TOOL_ERROR_HANDLING;
    const state = this.createResumedState(input);
    const requestCtx = this.createRequestContext(input);

    return this.runToCompletion(
      adapter,
      requestCtx,
      state,
      limits,
      toolErrorHandling,
      input.onTranscript,
      input.onSuspend,
      input.onCheckpoint,
    );
  }

  /** Streaming counterpart of {@link resume}. */
  async *resumeStream(input: AgentResumeInput): AsyncIterable<AgentStreamEvent> {
    const adapter = this.requireAdapter();
    const limits = this.resolveLimits(input.limits);
    const toolErrorHandling = input.toolErrorHandling ?? DEFAULT_TOOL_ERROR_HANDLING;
    const state = this.createResumedState(input);
    const requestCtx = this.createRequestContext(input);

    yield* this.streamToCompletion(
      adapter,
      requestCtx,
      state,
      limits,
      toolErrorHandling,
      input.onTranscript,
      input.onSuspend,
      input.onCheckpoint,
    );
  }

  /**
   * Resumes an execution turn directly from an InFlightCheckpoint snapshot.
   */
  async resumeCheckpoint(input: AgentResumeCheckpointInput): Promise<AgentResult> {
    const adapter = this.requireAdapter();
    const limits = this.resolveLimits(input.limits);
    const toolErrorHandling = input.toolErrorHandling ?? DEFAULT_TOOL_ERROR_HANDLING;
    const state = this.createCheckpointState(input);
    const requestCtx = this.createRequestContext(input);

    return this.runToCompletion(
      adapter,
      requestCtx,
      state,
      limits,
      toolErrorHandling,
      input.onTranscript,
      input.onSuspend,
      input.onCheckpoint,
    );
  }

  /** Streaming counterpart of {@link resumeCheckpoint}. */
  async *resumeCheckpointStream(
    input: AgentResumeCheckpointInput,
  ): AsyncIterable<AgentStreamEvent> {
    const adapter = this.requireAdapter();
    const limits = this.resolveLimits(input.limits);
    const toolErrorHandling = input.toolErrorHandling ?? DEFAULT_TOOL_ERROR_HANDLING;
    const state = this.createCheckpointState(input);
    const requestCtx = this.createRequestContext(input);

    yield* this.streamToCompletion(
      adapter,
      requestCtx,
      state,
      limits,
      toolErrorHandling,
      input.onTranscript,
      input.onSuspend,
      input.onCheckpoint,
    );
  }

  private async runToCompletion(
    adapter: ModelAdapter,
    requestCtx: ExecutorRequestContext,
    state: ExecutionState,
    limits: ExecutionLimits,
    toolErrorHandling: ToolErrorHandling,
    onTranscript?: AgentExecutionInput['onTranscript'],
    onSuspend?: AgentExecutionInput['onSuspend'],
    onCheckpoint?: AgentExecutionInput['onCheckpoint'],
  ): Promise<AgentResult> {
    const scope = this.createScope(requestCtx.signal, limits.timeoutMs);

    try {
      while (true) {
        this.assertWithinBudget(state, limits, scope);

        const request = this.buildRequest(requestCtx, state, scope);
        const reqStart = Date.now();

        await requestCtx.observerNotifier?.notifyModelRequest({
          agentName: requestCtx.agentName ?? 'agent',
          sessionId: requestCtx.sessionId,
          traceId: requestCtx.traceId ?? state.executionId,
          parentTraceId: requestCtx.parentTraceId,
          rootTraceId: requestCtx.rootTraceId,
          model: requestCtx.model,
          roundIndex: state.iteration,
          messages: request.messages,
          timestamp: new Date(reqStart),
        });

        const response = await adapter.generate(request);
        const reqDurationMs = Date.now() - reqStart;

        await requestCtx.observerNotifier?.notifyModelResponse({
          agentName: requestCtx.agentName ?? 'agent',
          sessionId: requestCtx.sessionId,
          traceId: requestCtx.traceId ?? state.executionId,
          parentTraceId: requestCtx.parentTraceId,
          rootTraceId: requestCtx.rootTraceId,
          model: requestCtx.model,
          roundIndex: state.iteration,
          response,
          usage: response.usage,
          durationMs: reqDurationMs,
          timestamp: new Date(),
        });

        const finished = await this.applyModelRound(
          requestCtx,
          state,
          response,
          requestCtx.tools,
          limits,
          scope,
          toolErrorHandling,
        );

        if (finished) {
          const result = this.toResult(requestCtx.sessionId, state, response.content);
          // Checkpointed first: once this returns, the caller holds the
          // approvalId and could settle it immediately.
          await this.publishCheckpoint(onSuspend, state);
          // The persisted transcript gets the model's actual content, never the
          // synthetic "requires approval" sentence resolveOutput() fabricates
          // for the caller — that text was never said by the model, and
          // storing it would misrepresent the conversation on resume.
          await this.publishTranscript(onTranscript, state, response.content);
          return result;
        }

        // Checkpoint in-flight state after each intermediate tool round
        await this.publishInFlightCheckpoint(onCheckpoint, state, requestCtx.sessionId);
      }
    } finally {
      scope.dispose();
    }
  }

  private async *streamToCompletion(
    adapter: ModelAdapter,
    requestCtx: ExecutorRequestContext,
    state: ExecutionState,
    limits: ExecutionLimits,
    toolErrorHandling: ToolErrorHandling,
    onTranscript: AgentExecutionInput['onTranscript'],
    onSuspend: AgentExecutionInput['onSuspend'],
    onCheckpoint?: AgentExecutionInput['onCheckpoint'],
  ): AsyncIterable<AgentStreamEvent> {
    const scope = this.createScope(requestCtx.signal, limits.timeoutMs);

    try {
      while (true) {
        this.assertWithinBudget(state, limits, scope);

        const request = this.buildRequest(requestCtx, state, scope);
        const reqStart = Date.now();

        await requestCtx.observerNotifier?.notifyModelRequest({
          agentName: requestCtx.agentName ?? 'agent',
          sessionId: requestCtx.sessionId,
          traceId: requestCtx.traceId ?? state.executionId,
          parentTraceId: requestCtx.parentTraceId,
          rootTraceId: requestCtx.rootTraceId,
          model: requestCtx.model,
          roundIndex: state.iteration,
          messages: request.messages,
          timestamp: new Date(reqStart),
        });

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

        const reqDurationMs = Date.now() - reqStart;
        await requestCtx.observerNotifier?.notifyModelResponse({
          agentName: requestCtx.agentName ?? 'agent',
          sessionId: requestCtx.sessionId,
          traceId: requestCtx.traceId ?? state.executionId,
          parentTraceId: requestCtx.parentTraceId,
          rootTraceId: requestCtx.rootTraceId,
          model: requestCtx.model,
          roundIndex: state.iteration,
          response,
          usage: response.usage,
          durationMs: reqDurationMs,
          timestamp: new Date(),
        });

        const pendingEvents: AgentStreamEvent[] = [];
        const finished = await this.applyModelRound(
          requestCtx,
          state,
          response,
          requestCtx.tools,
          limits,
          scope,
          toolErrorHandling,
          pendingEvents,
        );

        for (const event of pendingEvents) {
          yield event;
        }

        if (finished) {
          const output = this.resolveOutput(state, response.content);
          await this.publishCheckpoint(onSuspend, state);
          await this.publishTranscript(onTranscript, state, output);
          yield { type: 'final_answer', sessionId: requestCtx.sessionId, output, usage: state.usage };
          yield { type: 'complete', sessionId: requestCtx.sessionId, output };
          return;
        }

        // Checkpoint in-flight state after each intermediate stream round
        await this.publishInFlightCheckpoint(onCheckpoint, state, requestCtx.sessionId);
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

  /**
   * Rebuilds execution state from a persisted transcript, replacing the
   * withheld tool message with the resolved outcome so the model sees a
   * conversation that never actually paused.
   */
  private createResumedState(input: AgentResumeInput): ExecutionState {
    const messages: ModelMessage[] = [];
    if (input.instructions) {
      messages.push({ role: 'system', content: input.instructions });
    }
    messages.push(...input.history.map((message) => ({ ...message })));

    const index = messages.findIndex(
      (message) => message.role === 'tool' && message.toolCallId === input.toolCallId,
    );

    if (index === -1) {
      throw new ApprovalTranscriptMissingError(input.toolCallId);
    }

    const withheld = messages[index] as Extract<ModelMessage, { role: 'tool' }>;
    messages[index] = {
      ...withheld,
      content: JSON.stringify(input.outcome),
    };

    // Approval outcomes that were denied/rejected surface through the same
    // "pending_approval last, no assistant text" path as a fresh suspension,
    // so toolCalls is seeded with the resolved record for resolveOutput().
    const toolCalls: ToolCallRecord[] = [
      {
        toolName: input.toolName,
        args: input.args,
        result: input.outcome,
      },
    ];

    return {
      executionId: randomUUID(),
      messages,
      toolCalls,
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
    input: ExecutorRequestContext,
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
    requestCtx: ExecutorRequestContext,
    state: ExecutionState,
    response: ModelResponse,
    tools: ResolvedTool[],
    limits: ExecutionLimits,
    scope: { signal: AbortSignal; timedOut: () => boolean },
    toolErrorHandling: ToolErrorHandling,
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
      events?.push({
        type: 'action_call',
        id: call.id,
        toolName: tool.name,
        args: validation.args,
      });

      const toolStart = Date.now();
      await requestCtx.observerNotifier?.notifyToolCall({
        agentName: requestCtx.agentName ?? 'agent',
        sessionId: requestCtx.sessionId,
        traceId: requestCtx.traceId ?? state.executionId,
        parentTraceId: requestCtx.parentTraceId,
        rootTraceId: requestCtx.rootTraceId,
        toolName: tool.name,
        toolCallId: call.id,
        args: validation.args,
        timestamp: new Date(toolStart),
      });

      let result: ToolExecutionResult;
      try {
        result = await tool.execute({ args: validation.args, toolCallId: call.id });
      } catch (err) {
        const toolDurationMs = Date.now() - toolStart;
        // Framework errors signal misconfiguration, so they must not be hidden
        // from the caller by being described to the model.
        if (err instanceof AgenticError) throw err;

        // A tool that observed the abort should surface as cancellation.
        this.assertNotAborted(scope, limits);

        if (toolErrorHandling === 'throw') throw err;

        const failure = this.toFailurePayload(err);
        state.toolCalls.push({ toolName: tool.name, args: validation.args, result: failure });
        this.pushToolMessage(state, call, failure);
        events?.push({
          type: 'tool_error',
          id: call.id,
          toolName: tool.name,
          error: failure.error,
        });

        await requestCtx.observerNotifier?.notifyToolResult({
          agentName: requestCtx.agentName ?? 'agent',
          sessionId: requestCtx.sessionId,
          traceId: requestCtx.traceId ?? state.executionId,
          parentTraceId: requestCtx.parentTraceId,
          rootTraceId: requestCtx.rootTraceId,
          toolName: tool.name,
          toolCallId: call.id,
          result: failure,
          durationMs: toolDurationMs,
          timestamp: new Date(),
        });
        continue;
      }

      const toolDurationMs = Date.now() - toolStart;
      state.toolCalls.push({ toolName: tool.name, args: validation.args, result });
      this.pushToolMessage(state, call, result);

      await requestCtx.observerNotifier?.notifyToolResult({
        agentName: requestCtx.agentName ?? 'agent',
        sessionId: requestCtx.sessionId,
        traceId: requestCtx.traceId ?? state.executionId,
        parentTraceId: requestCtx.parentTraceId,
        rootTraceId: requestCtx.rootTraceId,
        toolName: tool.name,
        toolCallId: call.id,
        result,
        durationMs: toolDurationMs,
        timestamp: new Date(),
      });

      if (!result.success && result.status === 'pending_approval') {
        events?.push({
          type: 'approval_required',
          id: call.id,
          toolName: tool.name,
          approvalId: result.approvalId,
          reason: result.reason,
        });
        state.suspended = true;
        state.suspendedApprovalId = result.approvalId;
        return true;
      }

      events?.push({ type: 'tool_result', id: call.id, toolName: tool.name, result });
      events?.push({ type: 'action_observation', id: call.id, toolName: tool.name, result });
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

  /**
   * Normalizes a thrown value into a compact payload.
   * Only the message is forwarded, never a stack trace, so internal details do
   * not reach the model or the transcript.
   */
  private toFailurePayload(err: unknown): ToolFailurePayload {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw.length > MAX_TOOL_ERROR_LENGTH
      ? `${raw.slice(0, MAX_TOOL_ERROR_LENGTH)}...`
      : raw;

    return { success: false, status: 'error', error: message || 'Tool execution failed.' };
  }

  private pushToolMessage(
    state: ExecutionState,
    call: ModelToolCall,
    payload: ToolExecutionResult | ToolFailurePayload | { error: string },
  ): void {
    state.messages.push({
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content: JSON.stringify(payload),
    });
  }

  /**
   * Hands the suspension point to the caller so it can be checkpointed against
   * the approval. No-op unless the turn actually suspended for approval.
   *
   * The snapshot ends at the withheld tool message, which is what resuming
   * needs to locate — no final assistant text is appended, because the model
   * never produced one.
   */
  private async publishCheckpoint(
    onSuspend: AgentExecutionInput['onSuspend'],
    state: ExecutionState,
  ): Promise<void> {
    if (!onSuspend || !state.suspended || !state.suspendedApprovalId) return;

    await onSuspend(state.suspendedApprovalId, [...state.messages]);
  }

  /**
   * Hands the completed conversation to the caller for persistence, appending
   * the final answer so the next turn sees what the agent replied.
   */
  private async publishTranscript(
    onTranscript: AgentExecutionInput['onTranscript'],
    state: ExecutionState,
    output: string,
  ): Promise<void> {
    if (!onTranscript) return;

    const messages = [...state.messages];
    if (output) {
      messages.push({ role: 'assistant', content: output });
    }

    await onTranscript(messages);
  }

  private createCheckpointState(input: AgentResumeCheckpointInput): ExecutionState {
    if (input.checkpoint.version !== INFLIGHT_CHECKPOINT_VERSION) {
      throw new InFlightCheckpointVersionError(
        input.checkpoint.executionId,
        input.checkpoint.version,
        INFLIGHT_CHECKPOINT_VERSION,
      );
    }

    return {
      executionId: input.checkpoint.executionId,
      messages: [...input.checkpoint.messages],
      toolCalls: [],
      usage: { ...input.checkpoint.usage },
      toolCallCount: input.checkpoint.toolCallCount,
      iteration: input.checkpoint.iteration,
      suspended: false,
    };
  }

  private async publishInFlightCheckpoint(
    onCheckpoint: AgentExecutionInput['onCheckpoint'],
    state: ExecutionState,
    sessionId: string,
  ): Promise<void> {
    if (!onCheckpoint) return;

    const checkpoint: InFlightCheckpoint = {
      version: INFLIGHT_CHECKPOINT_VERSION,
      executionId: state.executionId,
      sessionId,
      iteration: state.iteration,
      messages: [...state.messages],
      usage: { ...state.usage },
      toolCallCount: state.toolCallCount,
      updatedAt: new Date().toISOString(),
    };

    await onCheckpoint(checkpoint);
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
