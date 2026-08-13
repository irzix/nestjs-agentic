import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import {
  AGENT_METADATA,
  AGENT_PROVIDERS,
  AGENTIC_OPTIONS,
  APPROVAL_STORE,
  RUNTIME_ADAPTER,
  SESSION_STORE,
} from '../constants';
import {
  ApprovalCheckpointVersionError,
  ApprovalTranscriptMissingError,
  RuntimeNotConfiguredError,
} from '../errors';
import { LocalToolProvider } from '../providers/local-tool.provider';
import type {
  AgentConfig,
  AgentContext,
  AgentProvider,
  AgentResult,
  AgentStreamEvent,
  ApprovalDecision,
  ApprovalStore,
  ModelConfig,
  PendingApproval,
  ResolvedTool,
  RuntimeAdapter,
  ToolExecutionResult,
} from '../interfaces';
import { APPROVAL_CHECKPOINT_VERSION } from '../interfaces';
import type {
  ExecutionLimits,
  ToolErrorHandling,
} from '../interfaces/execution.interface';
import type { ModelMessage } from '../interfaces/model.interface';
import {
  DEFAULT_SESSION_MAX_MESSAGES,
  isSessionRecord,
  type SessionOptions,
  type SessionRecord,
  type SessionStore,
} from '../interfaces/session.interface';
import { trimHistory, withoutSystemMessages } from '../utils/session-history';
import type { ModelAdapter } from '../interfaces/model.interface';

import type { StateStore } from '../interfaces/state-store.interface';
import { AgentExecutor } from './agent-executor.service';

export interface AgenticModuleOptions {
  defaultModel: ModelConfig;
  /** Custom unified StateStore (e.g. RedisStateStore, InMemoryStateStore) */
  stateStore?: StateStore;
  /**
   * Model adapter used by the built-in agent runtime.
   * Equivalent to providing the MODEL_ADAPTER token directly.
   */
  modelAdapter?: ModelAdapter;
  /** Default execution budgets applied to every agent run. */
  limits?: ExecutionLimits;
  /**
   * Default strategy for exceptions thrown by tools. Defaults to `report`,
   * which hands the error to the model instead of ending the run.
   */
  toolErrorHandling?: ToolErrorHandling;
  /** Custom SessionStore used for conversation history. */
  sessionStore?: SessionStore;
  /** Conversation history behavior for the built-in runtime. */
  session?: SessionOptions;
  /**
   * Default lifetime, in seconds, for approvals created when a policy returns
   * `require_approval`. After this window the approval expires and can no
   * longer be resolved (`ApprovalExpiredError`). A policy may override it per
   * decision via its own `ttlSeconds`. Unset means approvals never expire.
   */
  approvalTtlSeconds?: number;
}

export interface RunInput {
  sessionId: string;
  message: string;
  context?: {
    userId?: string;
    tenantId?: string;
    roles?: string[];
    permissions?: string[];
    data?: Record<string, unknown>;
  };
  /** Overrides agent and module execution budgets for this run. */
  limits?: ExecutionLimits;
  /** Overrides the agent and module tool error strategy for this run. */
  toolErrorHandling?: ToolErrorHandling;
  /**
   * Set false to run this turn without replaying or saving conversation history.
   * Defaults to the module session setting.
   */
  history?: boolean;
  /** Cancels the run when aborted. Honored by the built-in runtime. */
  signal?: AbortSignal;
}

/** Everything resolved from registration before a turn is executed. */
interface PreparedRun {
  config: AgentConfig;
  model: ModelConfig;
  context: AgentContext;
  tools: ResolvedTool[];
  limits?: ExecutionLimits;
  toolErrorHandling?: ToolErrorHandling;
}

@Injectable()
export class AgentRunner {
  constructor(
    @Optional() @Inject(AGENT_PROVIDERS) private readonly agentProviders: AgentProvider[],
    @Optional() @Inject(RUNTIME_ADAPTER) private readonly runtimeAdapter: RuntimeAdapter | undefined,
    @Inject(AGENTIC_OPTIONS) private readonly options: AgenticModuleOptions,
    private readonly localToolProvider: LocalToolProvider,
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly executor?: AgentExecutor,
    @Optional() @Inject(SESSION_STORE) private readonly sessionStore?: SessionStore,
    @Optional() @Inject(APPROVAL_STORE) private readonly approvalStore?: ApprovalStore,
  ) {}

  /**
   * Conversation history is scoped by tenant as well as session, so the same
   * session identifier used by two tenants can never share a transcript.
   */
  private sessionKey(context: AgentContext): string {
    const tenantId = context.security.tenantId;
    return tenantId ? `${tenantId}:${context.sessionId}` : context.sessionId;
  }

  private resolveSessionStore(): SessionStore | undefined {
    return this.options.sessionStore ?? this.sessionStore;
  }

  private historyEnabled(input: RunInput): boolean {
    const configured = this.options.session?.enabled ?? true;
    return (input.history ?? configured) && Boolean(this.resolveSessionStore());
  }

  /**
   * Loads history untrimmed, preserving system messages.
   *
   * Resuming a suspended turn must locate the exact withheld tool message by
   * `toolCallId`, so it cannot use `loadHistory()`'s trimming, which may drop
   * older messages or strip the system instructions the trimmed replay
   * re-derives from `AgentConfig` instead.
   */
  private async loadRawHistory(context: AgentContext): Promise<ModelMessage[] | undefined> {
    const store = this.resolveSessionStore();
    if (!store) return undefined;

    try {
      const stored = await store.get(this.sessionKey(context));
      return isSessionRecord(stored) ? stored.messages : undefined;
    } catch {
      return undefined;
    }
  }

  private async loadHistory(context: AgentContext): Promise<ModelMessage[]> {
    const store = this.resolveSessionStore();
    if (!store) return [];

    try {
      const stored = await store.get(this.sessionKey(context));
      if (!isSessionRecord(stored)) return [];

      return trimHistory(
        withoutSystemMessages(stored.messages),
        this.options.session?.maxMessages ?? DEFAULT_SESSION_MAX_MESSAGES,
      );
    } catch {
      // A history read must never fail the turn; the agent continues stateless.
      return [];
    }
  }

  /**
   * Resolves a human decision on a suspended tool call.
   *
   * Invokes the tool (on approval) or builds a denial (on rejection), then
   * resumes the original model turn when it was suspended by the built-in
   * runtime — the model sees the outcome and can react to it, exactly as it
   * would to any other tool result. When the approval did not originate from
   * the built-in runtime (no `toolCallId`, e.g. an agent driven by a
   * `RuntimeAdapter`), only the tool outcome is returned, matching prior
   * behavior for that path.
   */
  async settleApproval(
    pending: PendingApproval,
    decision: ApprovalDecision,
    options?: { signal?: AbortSignal },
  ): Promise<AgentResult | ToolExecutionResult> {
    const agent = this.getAgentMap().get(pending.agentName);
    if (!agent) {
      throw new Error(
        `Agent "${pending.agentName}" is not registered. ` +
          `It may have been renamed or removed since this approval was created.`,
      );
    }

    const config = agent.define();

    const outcome: ToolExecutionResult = decision.approved
      ? await this.localToolProvider.invokeApprovedTool(
          config.tools,
          pending.toolName,
          pending.args,
          pending.context,
        )
      : { success: false, status: 'denied', reason: decision.reason ?? pending.reason };

    if (!pending.toolCallId || !this.executor?.isAvailable()) {
      return outcome;
    }

    const history = await this.resolveResumeHistory(pending);
    const store = this.resolveSessionStore();

    return this.executor.resume({
      sessionId: pending.context.sessionId,
      model: config.model ?? this.options.defaultModel,
      tools: this.localToolProvider.buildTools(
        config.tools,
        pending.context,
        pending.agentName,
        this.options.approvalTtlSeconds,
      ),
      traceId: pending.context.traceId,
      instructions: config.instructions,
      history,
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      args: pending.args,
      outcome,
      limits: config.limits ?? this.options.limits,
      toolErrorHandling: config.toolErrorHandling ?? this.options.toolErrorHandling,
      signal: options?.signal,
      onTranscript: store
        ? (messages) => this.saveHistory(pending.context, messages)
        : undefined,
      // A resumed turn can suspend again on a further approval, which needs its
      // own checkpoint.
      onSuspend: (approvalId, messages) => this.saveCheckpoint(approvalId, messages),
    });
  }

  /**
   * Records the suspension point on the approval itself, so resuming does not
   * depend on `SessionStore` still holding the withheld tool message.
   *
   * The approval was already saved by the tool's policy chain; this attaches
   * the checkpoint to it. Runs before the suspended turn returns, so no caller
   * can hold the `approvalId` yet and there is nothing to race with.
   */
  private async saveCheckpoint(approvalId: string, messages: ModelMessage[]): Promise<void> {
    if (!this.approvalStore) return;

    try {
      const pending = await this.approvalStore.get(approvalId);
      if (!pending) return;

      await this.approvalStore.save({
        ...pending,
        checkpoint: {
          version: APPROVAL_CHECKPOINT_VERSION,
          // Untrimmed: resume must still find the withheld tool call. System
          // messages are dropped because instructions are re-derived from the
          // agent's config on resume.
          messages: withoutSystemMessages(messages),
        },
      });
    } catch {
      // Checkpointing is an optimization over reading session history; failing
      // to write it must not fail the turn that is already suspended.
    }
  }

  /**
   * Transcript used to resume a suspended turn.
   *
   * The approval's own checkpoint is authoritative. Session history is only a
   * fallback for approvals created before checkpointing existed, and it can be
   * trimmed past the suspension point.
   */
  private async resolveResumeHistory(pending: PendingApproval): Promise<ModelMessage[]> {
    const checkpoint = pending.checkpoint;

    if (checkpoint) {
      if (checkpoint.version !== APPROVAL_CHECKPOINT_VERSION) {
        throw new ApprovalCheckpointVersionError(
          pending.id,
          checkpoint.version,
          APPROVAL_CHECKPOINT_VERSION,
        );
      }
      return checkpoint.messages;
    }

    const history = await this.loadRawHistory(pending.context);
    if (!history) {
      throw new ApprovalTranscriptMissingError(pending.toolCallId!);
    }
    return history;
  }

  private async saveHistory(context: AgentContext, messages: ModelMessage[]): Promise<void> {
    const store = this.resolveSessionStore();
    if (!store) return;

    const record: SessionRecord = {
      sessionId: context.sessionId,
      messages: trimHistory(
        withoutSystemMessages(messages),
        this.options.session?.maxMessages ?? DEFAULT_SESSION_MAX_MESSAGES,
      ),
      updatedAt: new Date().toISOString(),
    };

    await store.set(this.sessionKey(context), record);
  }

  private getAgentMap(): Map<string, AgentProvider> {
    let providers = Array.isArray(this.agentProviders) ? this.agentProviders : [];
    if (providers.length === 0) {
      try {
        providers = this.moduleRef.get(AGENT_PROVIDERS, { strict: false, each: true });
      } catch {
        providers = [];
      }
    }
    const map = new Map<string, AgentProvider>();
    const list = (Array.isArray(providers) ? providers : [providers]).flat(Infinity);
    for (const agent of list) {
      if (!agent) continue;
      const target = typeof agent === 'function' ? agent : agent.constructor;
      const metadata: { name: string } =
        Reflect.getMetadata(AGENT_METADATA, target) ??
        (typeof agent === 'object' ? Reflect.getMetadata(AGENT_METADATA, agent) : undefined);
      if (metadata?.name) {
        map.set(metadata.name, agent);
      }
    }
    return map;
  }

  /**
   * Resolves the registered agent, builds its execution context, and turns its
   * declared tool sets into policy-guarded closures.
   */
  private prepare(agentName: string, input: RunInput): PreparedRun {
    const agent = this.getAgentMap().get(agentName);

    if (!agent) {
      throw new Error(
        `Agent "${agentName}" is not registered. ` +
          `Add it to AgenticModule.forFeature({ agents: [...] }).`,
      );
    }

    const config = agent.define();
    const context: AgentContext = {
      sessionId: input.sessionId,
      traceId: randomUUID(),
      security: {
        userId: input.context?.userId,
        tenantId: input.context?.tenantId,
        roles: input.context?.roles,
        permissions: input.context?.permissions,
      },
      data: input.context?.data,
    };

    return {
      config,
      model: config.model ?? this.options.defaultModel,
      context,
      tools: this.localToolProvider.buildTools(
        config.tools,
        context,
        agentName,
        this.options.approvalTtlSeconds,
      ),
      limits: input.limits ?? config.limits ?? this.options.limits,
      toolErrorHandling:
        input.toolErrorHandling ?? config.toolErrorHandling ?? this.options.toolErrorHandling,
    };
  }

  /**
   * The built-in runtime is used whenever a ModelAdapter is registered.
   * Applications without one keep delegating whole turns to a RuntimeAdapter.
   */
  private useBuiltInRuntime(): boolean {
    return Boolean(this.executor?.isAvailable());
  }

  private requireRuntimeAdapter(): RuntimeAdapter {
    if (!this.runtimeAdapter) {
      throw new RuntimeNotConfiguredError();
    }
    return this.runtimeAdapter;
  }

  async run(agentName: string, input: RunInput): Promise<AgentResult> {
    const prepared = this.prepare(agentName, input);

    if (this.useBuiltInRuntime()) {
      const withHistory = this.historyEnabled(input);

      return this.executor!.execute({
        sessionId: input.sessionId,
        message: input.message,
        model: prepared.model,
        tools: prepared.tools,
        instructions: prepared.config.instructions,
        traceId: prepared.context.traceId,
        limits: prepared.limits,
        toolErrorHandling: prepared.toolErrorHandling,
        signal: input.signal,
        history: withHistory ? await this.loadHistory(prepared.context) : undefined,
        onTranscript: withHistory
          ? (messages) => this.saveHistory(prepared.context, messages)
          : undefined,
        // Independent of history being enabled: an approval must stay resumable
        // even for a stateless turn.
        onSuspend: (approvalId, messages) => this.saveCheckpoint(approvalId, messages),
      });
    }

    return this.requireRuntimeAdapter().execute({
      sessionId: input.sessionId,
      message: input.message,
      tools: prepared.tools,
      model: prepared.model,
      instructions: prepared.config.instructions,
    });
  }

  async *runStream(agentName: string, input: RunInput): AsyncIterable<AgentStreamEvent> {
    const prepared = this.prepare(agentName, input);

    if (this.useBuiltInRuntime()) {
      const withHistory = this.historyEnabled(input);

      yield* this.executor!.stream({
        sessionId: input.sessionId,
        message: input.message,
        model: prepared.model,
        tools: prepared.tools,
        instructions: prepared.config.instructions,
        traceId: prepared.context.traceId,
        limits: prepared.limits,
        toolErrorHandling: prepared.toolErrorHandling,
        signal: input.signal,
        history: withHistory ? await this.loadHistory(prepared.context) : undefined,
        onTranscript: withHistory
          ? (messages) => this.saveHistory(prepared.context, messages)
          : undefined,
        onSuspend: (approvalId, messages) => this.saveCheckpoint(approvalId, messages),
      });
      return;
    }

    const adapter = this.requireRuntimeAdapter();
    const adapterInput = {
      sessionId: input.sessionId,
      message: input.message,
      tools: prepared.tools,
      model: prepared.model,
      instructions: prepared.config.instructions,
    };

    if (adapter.stream) {
      yield* adapter.stream(adapterInput);
      return;
    }

    const res = await adapter.execute(adapterInput);
    for (const toolCall of res.toolCalls) {
      yield { type: 'tool_start', toolName: toolCall.toolName, args: toolCall.args };
      yield { type: 'tool_result', toolName: toolCall.toolName, result: toolCall.result as any };
    }
    yield { type: 'token', text: res.output };
    yield { type: 'complete', sessionId: res.sessionId, output: res.output };
  }
}
