import { Inject, Injectable, Optional, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import {
  AGENT_METADATA,
  AGENT_OBSERVERS,
  AGENT_PROVIDERS,
  AGENTIC_OPTIONS,
  APPROVAL_STORE,
  RUNTIME_ADAPTER,
  SESSION_STORE,
} from '../constants';
import {
  ApprovalCheckpointVersionError,
  ApprovalToolNotFoundError,
  ApprovalTranscriptMissingError,
  CheckpointNotFoundError,
  ExecutionCancelledError,
  RuntimeNotConfiguredError,
} from '../errors';
import { LocalToolProvider } from '../providers/local-tool.provider';
import type { AgentDecoratorOptions } from '../decorators/agent.decorator';
import type {
  AgentConfig,
  AgentContext,
  AgentObserver,
  AgentProvider,
  AgentResult,
  AgentStreamEvent,
  ApprovalAuthorizerRegistration,
  ApprovalDecision,
  ApprovalGovernanceOptions,
  ApprovalStore,
  AuditOptions,
  AuditSink,
  CascadeConfig,
  IdempotencyStore,
  ModelConfig,
  PendingApproval,
  ResolvedTool,
  RuntimeAdapter,
  ToolExecutionResult,
  ToolPolicy,
  ToolProvider,
} from '../interfaces';
import { APPROVAL_CHECKPOINT_VERSION, isToolProvider } from '../interfaces';
import {
  DEFAULT_CHECKPOINT_TTL_SECONDS,
  type ExecutionLimits,
  type InFlightCheckpoint,
  type ToolErrorHandling,
} from '../interfaces/execution.interface';
import {
  DEFAULT_SESSION_MAX_MESSAGES,
  isSessionRecord,
  type SessionOptions,
  type SessionRecord,
  type SessionStore,
} from '../interfaces/session.interface';
import { trimHistory, withoutSystemMessages } from '../utils/session-history';
import { scopeKey } from '../utils/scope-key';
import type { ModelAdapter, ModelMessage, ModelUsage } from '../interfaces/model.interface';
import { ObserverNotifier } from '../observers/observer-notifier';
import type { ModelResilienceOptions } from '../adapters/resilient-model.adapter';

import { STATE_STORE, type StateStore } from '../interfaces/state-store.interface';
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
  /** Custom ApprovalStore used for HITL approval records. */
  approvalStore?: ApprovalStore;
  /** Custom SessionStore used for conversation history. */
  sessionStore?: SessionStore;
  /** Custom IdempotencyStore used for deduplicating tool executions. */
  idempotencyStore?: IdempotencyStore;
  /** Conversation history behavior for the built-in runtime. */
  session?: SessionOptions;
  /**
   * Default lifetime, in seconds, for approvals created when a policy returns
   * `require_approval`. After this window the approval expires and can no
   * longer be resolved (`ApprovalExpiredError`). A policy may override it per
   * decision via its own `ttlSeconds`. Unset means approvals never expire.
   */
  approvalTtlSeconds?: number;
  /**
   * Default lifetime in seconds for in-flight execution checkpoints stored in StateStore.
   * Default: 86400 (24 hours).
   */
  checkpointTtlSeconds?: number;
  /**
   * Recording behavior for the audit trail. Only takes effect when at least one
   * `AuditSink` is registered through the `AUDIT_SINKS` token.
   */
  audit?: AuditOptions;
  /**
   * Retry-with-backoff and circuit-breaker behavior for model calls, applied on
   * top of whatever retrying an adapter's own SDK performs. Unset leaves model
   * calls unwrapped.
   */
  resilience?: ModelResilienceOptions;
  /**
   * Destinations for audit events. Equivalent to providing the `AUDIT_SINKS`
   * token directly. Auditing is opt-in: with no sink the framework records
   * nothing.
   */
  auditSinks?: AuditSink[];
  /**
   * Optional runtime observers to receive lifecycle events, OpenTelemetry traces, and metrics.
   */
  observers?: AgentObserver[];
  /**
   * Sampling rate between 0.0 (0%) and 1.0 (100%) for observer telemetry dispatching.
   * Default: 1.0
   */
  samplingRate?: number;
  /**
   * Policy classes run against every discovered tool that doesn't opt out via
   * `@ExemptFromDefaultPolicies()`, so a tool with no `@UsePolicies` at all is
   * not silently unguarded. Each class must also be registered as a provider
   * (e.g. via `AgenticModule.forFeature({ policies: [...] })`) so it resolves
   * through DI like any other policy. Evaluated before class-level and
   * method-level `@UsePolicies`, in array order.
   */
  defaultPolicies?: Type<ToolPolicy>[];
  /**
   * Governance behavior for settling pending approvals (e.g. enforcing
   * separation of duties). Authorization itself is supplied by registering an
   * `ApprovalAuthorizer` through the `APPROVAL_AUTHORIZER` token.
   */
  approvals?: ApprovalGovernanceOptions;
  /**
   * Decides who may settle a pending approval. Register it here rather than in
   * the importing module: `ApprovalService` is constructed inside `AgenticModule`,
   * so a provider declared outside it is not visible.
   *
   * Accepts `{ useClass }` or `{ useFactory, inject }` so the authorizer is built
   * by Nest and can inject its own dependencies, or a bare instance when it needs
   * nothing injected.
   */
  approvalAuthorizer?: ApprovalAuthorizerRegistration;
  /** Overrides for internal diagnostic logging (e.g. governance warnings). Defaults to `console`. */
  logger?: { warn?: (message: string) => void };
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
    traceId?: string;
    parentTraceId?: string;
    rootTraceId?: string;
    signal?: AbortSignal;
    deadline?: Date;
  };
  /** Overrides agent and module execution budgets for this run. */
  limits?: ExecutionLimits;
  /** Overrides the agent and module tool error strategy for this run. */
  toolErrorHandling?: ToolErrorHandling;
  /** FrugalGPT model cascading configuration (fastModel -> reasoningModel). */
  cascade?: CascadeConfig;
  /**
   * Set false to run this turn without replaying or saving conversation history.
   * Defaults to the module session setting.
   */
  history?: boolean;
  /** Cancels the run when aborted. Honored by the built-in runtime. */
  signal?: AbortSignal;
}

export interface ResumeCheckpointOptions {
  signal?: AbortSignal;
  limits?: ExecutionLimits;
  context?: RunInput['context'];
}

export interface RecoverCheckpointOptions {
  signal?: AbortSignal;
  limits?: ExecutionLimits;
  context?: RunInput['context'];
}

/** Everything resolved from registration before a turn is executed. */
export interface PreparedRun {
  config: AgentConfig;
  model: ModelConfig;
  cascade?: CascadeConfig;
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
    @Optional() @Inject(STATE_STORE) private readonly stateStore?: StateStore,
    @Optional() @Inject(AGENT_OBSERVERS) private readonly injectedObservers?: AgentObserver[],
  ) {}

  private getNotifier(): ObserverNotifier {
    const fromOptions = this.options.observers ?? [];
    const fromInjected: AgentObserver[] = [];
    if (this.injectedObservers) {
      const collect = (item: unknown): void => {
        if (Array.isArray(item)) {
          item.forEach(collect);
        } else if (item && typeof item === 'object') {
          fromInjected.push(item as AgentObserver);
        }
      };
      collect(this.injectedObservers);
    }
    const all = [...fromOptions, ...fromInjected];
    const unique = Array.from(new Set(all.filter((o): o is AgentObserver => Boolean(o))));
    return new ObserverNotifier(unique, { samplingRate: this.options.samplingRate });
  }

  /**
   * Conversation history is scoped by tenant as well as session, so the same
   * session identifier used by two tenants can never share a transcript.
   * Uses `scopeKey` rather than plain concatenation, since a `:` inside
   * `tenantId` could otherwise collide two different (tenant, session) pairs
   * onto the same storage key.
   */
  private sessionKey(context: AgentContext): string {
    const tenantId = context.security.tenantId;
    return tenantId ? scopeKey(tenantId, context.sessionId) : context.sessionId;
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
    if (options?.signal?.aborted) {
      throw new ExecutionCancelledError();
    }

    const agent = this.getAgentMap().get(pending.agentName);
    if (!agent) {
      throw new Error(
        `Agent "${pending.agentName}" is not registered. ` +
          `It may have been renamed or removed since this approval was created.`,
      );
    }

    const config = agent.define();

    const outcome: ToolExecutionResult = decision.approved
      ? await this.invokeApprovedToolFromConfig(
          config.tools,
          pending.toolName,
          pending.args,
          pending.context,
          pending.agentName,
        )
      : { success: false, status: 'denied', reason: decision.reason ?? pending.reason };

    if (!pending.toolCallId || !this.executor?.isAvailable()) {
      return outcome;
    }

    const history = await this.resolveResumeHistory(pending);
    const store = this.resolveSessionStore();
    const notifier = this.getNotifier();
    const metadata = this.getAgentMetadata(agent);

    return this.executor.resume({
      agentName: pending.agentName,
      observerNotifier: notifier,
      sessionId: pending.context.sessionId,
      model: config.model ?? metadata?.model ?? this.options.defaultModel,
      cascade: config.cascade ?? metadata?.cascade,
      tools: await this.buildTools(config.tools, pending.context, pending.agentName),
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
      onCheckpoint: (checkpoint) => this.saveInFlightCheckpoint(pending.context, checkpoint),
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

  private getAgentMetadata(agent: unknown): AgentDecoratorOptions | undefined {
    if (!agent) return undefined;
    const target = typeof agent === 'function' ? agent : (agent as object).constructor;
    return (
      Reflect.getMetadata(AGENT_METADATA, target) ??
      (typeof agent === 'object' ? Reflect.getMetadata(AGENT_METADATA, agent) : undefined)
    );
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
      const metadata = this.getAgentMetadata(agent);
      if (metadata?.name) {
        map.set(metadata.name, agent);
      }
    }
    return map;
  }

  /**
   * Resolves a tool token to a ToolProvider instance if it implements the interface
   * directly or is resolvable via the NestJS DI container.
   */
  private resolveProviderInstance(token: unknown): ToolProvider | null {
    if (isToolProvider(token)) {
      return token;
    }
    if (typeof token === 'function' || typeof token === 'string' || typeof token === 'symbol') {
      try {
        const instance = this.moduleRef.get(token as unknown as string | symbol | Function, { strict: false });
        if (isToolProvider(instance)) {
          return instance;
        }
      } catch {
        // Not a registered ToolProvider token, treat as local tool class
      }
    }
    return null;
  }

  /**
   * Resolves all tool definitions across both custom ToolProviders and local decorator tools.
   */
  private async buildTools(
    toolTokens: (object | Function)[],
    context: AgentContext,
    agentName: string,
  ): Promise<ResolvedTool[]> {
    const tools: ResolvedTool[] = [];
    const localTokens: (object | Function)[] = [];

    for (const token of toolTokens) {
      const provider = this.resolveProviderInstance(token);
      if (provider) {
        const resolved = await provider.getTools(context, agentName);
        tools.push(...resolved);
      } else {
        localTokens.push(token);
      }
    }

    if (localTokens.length > 0) {
      tools.push(
        ...this.localToolProvider.buildTools(
          localTokens,
          context,
          agentName,
          this.options.approvalTtlSeconds,
        ),
      );
    }
    return tools;
  }

  /**
   * Invokes an approved tool directly across registered providers and local tools.
   */
  private async invokeApprovedToolFromConfig(
    tools: (object | Function)[],
    toolName: string,
    args: Record<string, unknown>,
    context: AgentContext,
    agentName = '',
  ): Promise<ToolExecutionResult> {
    const localTokens: (object | Function)[] = [];

    for (const token of tools) {
      const provider = this.resolveProviderInstance(token);
      if (provider?.invokeApprovedTool) {
        try {
          return await provider.invokeApprovedTool(toolName, args, context);
        } catch (err: unknown) {
          if ((err as Error)?.name !== 'ApprovalToolNotFoundError') throw err;
        }
      } else if (!provider) {
        localTokens.push(token);
      }
    }

    if (localTokens.length > 0) {
      return this.localToolProvider.invokeApprovedTool(localTokens, toolName, args, context, agentName);
    }

    throw new ApprovalToolNotFoundError(toolName);
  }

  /**
   * Resolves the registered agent, builds its execution context, and turns its
   * declared tool sets into policy-guarded closures.
   */
  async prepare(agentName: string, input: RunInput): Promise<PreparedRun> {
    const agent = this.getAgentMap().get(agentName);

    if (!agent) {
      throw new Error(
        `Agent "${agentName}" is not registered. ` +
          `Add it to AgenticModule.forFeature({ agents: [...] }).`,
      );
    }

    const config = agent.define();
    const limits = input.limits ?? config.limits ?? this.options.limits;
    const deadline =
      limits?.timeoutMs !== undefined ? new Date(Date.now() + limits.timeoutMs) : undefined;

    const traceId = input.context?.traceId ?? randomUUID();
    const parentTraceId = input.context?.parentTraceId;
    const rootTraceId = input.context?.rootTraceId ?? (parentTraceId ? undefined : traceId);

    const context: AgentContext = {
      sessionId: input.sessionId,
      traceId,
      parentTraceId,
      rootTraceId,
      security: {
        userId: input.context?.userId,
        tenantId: input.context?.tenantId,
        roles: input.context?.roles,
        permissions: input.context?.permissions,
      },
      data: input.context?.data,
      signal: input.signal,
      deadline,
    };

    const metadata = this.getAgentMetadata(agent);

    return {
      config,
      model: config.model ?? metadata?.model ?? this.options.defaultModel,
      cascade: input.cascade ?? config.cascade ?? metadata?.cascade,
      context,
      tools: await this.buildTools(config.tools, context, agentName),
      limits,
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
    const prepared = await this.prepare(agentName, input);
    const notifier = this.getNotifier();
    const startAt = Date.now();

    await notifier.notifyAgentStart({
      agentName,
      sessionId: prepared.context.sessionId,
      traceId: prepared.context.traceId,
      parentTraceId: prepared.context.parentTraceId,
      rootTraceId: prepared.context.rootTraceId,
      tenantId: prepared.context.security.tenantId,
      userId: prepared.context.security.userId,
      message: input.message,
      timestamp: new Date(startAt),
      context: prepared.context,
    });

    try {
      let result: AgentResult;

      if (this.useBuiltInRuntime()) {
        const withHistory = this.historyEnabled(input);

        result = await this.executor!.execute({
          agentName,
          sessionId: input.sessionId,
          message: input.message,
          model: prepared.model,
          cascade: prepared.cascade,
          tools: prepared.tools,
          instructions: prepared.config.instructions,
          traceId: prepared.context.traceId,
          parentTraceId: prepared.context.parentTraceId,
          rootTraceId: prepared.context.rootTraceId,
          limits: prepared.limits,
          toolErrorHandling: prepared.toolErrorHandling,
          signal: input.signal,
          observerNotifier: notifier,
          history: withHistory ? await this.loadHistory(prepared.context) : undefined,
          onCheckpoint: (checkpoint) =>
            this.saveInFlightCheckpoint(prepared.context, checkpoint),
          onTranscript: withHistory
            ? (messages) => this.saveHistory(prepared.context, messages)
            : undefined,
          // Independent of history being enabled: an approval must stay resumable
          // even for a stateless turn.
          onSuspend: (approvalId, messages) => this.saveCheckpoint(approvalId, messages),
        });
      } else {
        result = await this.requireRuntimeAdapter().execute({
          sessionId: input.sessionId,
          message: input.message,
          tools: prepared.tools,
          model: prepared.model,
          instructions: prepared.config.instructions,
        });
      }

      const durationMs = Date.now() - startAt;
      await notifier.notifyAgentEnd({
        agentName,
        sessionId: prepared.context.sessionId,
        traceId: prepared.context.traceId,
        parentTraceId: prepared.context.parentTraceId,
        rootTraceId: prepared.context.rootTraceId,
        tenantId: prepared.context.security.tenantId,
        result,
        durationMs,
        totalTokensUsed: result.usage?.totalTokens,
        timestamp: new Date(),
        context: prepared.context,
      });

      return { ...result, durationMs };
    } catch (err: unknown) {
      const durationMs = Date.now() - startAt;
      await notifier.notifyError({
        agentName,
        sessionId: prepared.context.sessionId,
        traceId: prepared.context.traceId,
        parentTraceId: prepared.context.parentTraceId,
        rootTraceId: prepared.context.rootTraceId,
        error: err instanceof Error ? err : new Error(String(err)),
        durationMs,
        timestamp: new Date(),
        context: prepared.context,
      });
      throw err;
    }
  }

  async *runStream(agentName: string, input: RunInput): AsyncIterable<AgentStreamEvent> {
    const prepared = await this.prepare(agentName, input);
    const notifier = this.getNotifier();
    const startAt = Date.now();

    await notifier.notifyAgentStart({
      agentName,
      sessionId: prepared.context.sessionId,
      traceId: prepared.context.traceId,
      parentTraceId: prepared.context.parentTraceId,
      rootTraceId: prepared.context.rootTraceId,
      tenantId: prepared.context.security.tenantId,
      userId: prepared.context.security.userId,
      message: input.message,
      timestamp: new Date(startAt),
      context: prepared.context,
    });

    try {
      if (this.useBuiltInRuntime()) {
        const withHistory = this.historyEnabled(input);
        let finalUsage: ModelUsage | undefined;
        let finalOutput = '';
        let wasSuspended = false;

        for await (const event of this.executor!.stream({
          agentName,
          sessionId: input.sessionId,
          message: input.message,
          model: prepared.model,
          cascade: prepared.cascade,
          tools: prepared.tools,
          instructions: prepared.config.instructions,
          traceId: prepared.context.traceId,
          parentTraceId: prepared.context.parentTraceId,
          rootTraceId: prepared.context.rootTraceId,
          limits: prepared.limits,
          toolErrorHandling: prepared.toolErrorHandling,
          signal: input.signal,
          observerNotifier: notifier,
          history: withHistory ? await this.loadHistory(prepared.context) : undefined,
          onCheckpoint: (checkpoint) =>
            this.saveInFlightCheckpoint(prepared.context, checkpoint),
          onTranscript: withHistory
            ? (messages) => this.saveHistory(prepared.context, messages)
            : undefined,
          onSuspend: (approvalId, messages) => this.saveCheckpoint(approvalId, messages),
        })) {
          if (event.type === 'approval_required') {
            wasSuspended = true;
          }
          if (event.type === 'final_answer') {
            finalOutput = event.output;
            finalUsage = event.usage;
          }
          yield event;
        }

        const durationMs = Date.now() - startAt;
        const result: AgentResult = {
          sessionId: input.sessionId,
          output: finalOutput,
          toolCalls: [],
          usage: finalUsage,
        };

        await notifier.notifyAgentEnd({
          agentName,
          sessionId: prepared.context.sessionId,
          traceId: prepared.context.traceId,
          parentTraceId: prepared.context.parentTraceId,
          rootTraceId: prepared.context.rootTraceId,
          tenantId: prepared.context.security.tenantId,
          result,
          durationMs,
          totalTokensUsed: finalUsage?.totalTokens,
          timestamp: new Date(),
          context: prepared.context,
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
      } else {
        const res = await adapter.execute(adapterInput);
        for (const toolCall of res.toolCalls) {
          const callId = `call_${randomUUID().slice(0, 8)}`;
          const toolResult: ToolExecutionResult =
            toolCall.result && typeof toolCall.result === 'object' && 'success' in toolCall.result
              ? (toolCall.result as ToolExecutionResult)
              : { success: true, data: toolCall.result };

          yield { type: 'tool_start', id: callId, toolName: toolCall.toolName, args: toolCall.args };
          yield { type: 'action_call', id: callId, toolName: toolCall.toolName, args: toolCall.args };
          yield { type: 'tool_result', id: callId, toolName: toolCall.toolName, result: toolResult };
          yield { type: 'action_observation', id: callId, toolName: toolCall.toolName, result: toolResult };
        }
        yield { type: 'token', text: res.output };
        yield { type: 'final_answer', sessionId: res.sessionId, output: res.output, usage: res.usage };
        yield { type: 'complete', sessionId: res.sessionId, output: res.output };
      }

      const durationMs = Date.now() - startAt;
      await notifier.notifyAgentEnd({
        agentName,
        sessionId: prepared.context.sessionId,
        traceId: prepared.context.traceId,
        tenantId: prepared.context.security.tenantId,
        result: {
          sessionId: input.sessionId,
          output: '',
          toolCalls: [],
        },
        durationMs,
        timestamp: new Date(),
        context: prepared.context,
      });
    } catch (err: unknown) {
      const durationMs = Date.now() - startAt;
      await notifier.notifyError({
        agentName,
        sessionId: prepared.context.sessionId,
        traceId: prepared.context.traceId,
        error: err instanceof Error ? err : new Error(String(err)),
        durationMs,
        timestamp: new Date(),
        context: prepared.context,
      });
      throw err;
    }
  }

  /**
   * Resumes an interrupted agent execution turn directly from an InFlightCheckpoint snapshot.
   */
  async resumeCheckpoint(
    agentName: string,
    checkpoint: InFlightCheckpoint,
    options?: ResumeCheckpointOptions,
  ): Promise<AgentResult> {
    const agent = this.getAgentMap().get(agentName);
    if (!agent) {
      throw new Error(`Agent "${agentName}" is not registered.`);
    }

    if (!this.executor?.isAvailable()) {
      throw new RuntimeNotConfiguredError();
    }

    const config = agent.define();
    const limits = options?.limits ?? config.limits ?? this.options.limits;
    const deadline =
      limits?.timeoutMs !== undefined ? new Date(Date.now() + limits.timeoutMs) : undefined;

    const context: AgentContext = {
      sessionId: checkpoint.sessionId,
      traceId: randomUUID(),
      security: {
        userId: options?.context?.userId,
        tenantId: options?.context?.tenantId,
        roles: options?.context?.roles,
        permissions: options?.context?.permissions,
      },
      data: options?.context?.data,
      signal: options?.signal,
      deadline,
    };

    const tools = await this.buildTools(config.tools, context, agentName);

    const sessionStore = this.resolveSessionStore();
    const notifier = this.getNotifier();

    const metadata = this.getAgentMetadata(agent);

    return this.executor.resumeCheckpoint({
      agentName,
      observerNotifier: notifier,
      sessionId: checkpoint.sessionId,
      checkpoint,
      model: config.model ?? metadata?.model ?? this.options.defaultModel,
      cascade: config.cascade ?? metadata?.cascade,
      tools,
      instructions: config.instructions,
      traceId: context.traceId,
      limits,
      toolErrorHandling: config.toolErrorHandling ?? this.options.toolErrorHandling,
      signal: options?.signal,
      onCheckpoint: (cp) => this.saveInFlightCheckpoint(context, cp),
      onTranscript: sessionStore
        ? (messages) => this.saveHistory(context, messages)
        : undefined,
      onSuspend: (approvalId, messages) => this.saveCheckpoint(approvalId, messages),
    });
  }

  /**
   * Recovers and resumes the latest in-flight checkpoint recorded for a given session.
   */
  async recoverLatestCheckpoint(
    agentName: string,
    sessionId: string,
    options?: RecoverCheckpointOptions,
  ): Promise<AgentResult> {
    const store = this.options.stateStore ?? this.stateStore;
    if (!store) {
      throw new CheckpointNotFoundError(`latest:${sessionId} (no StateStore configured)`);
    }

    const dummyContext: AgentContext = {
      sessionId,
      traceId: 'recovery',
      security: {
        userId: options?.context?.userId,
        tenantId: options?.context?.tenantId,
        roles: options?.context?.roles,
        permissions: options?.context?.permissions,
      },
      data: options?.context?.data,
      signal: options?.signal,
    };

    const latestKey = `checkpoint:latest:${this.sessionKey(dummyContext)}`;
    const checkpoint = await store.get<InFlightCheckpoint>(latestKey);

    if (!checkpoint) {
      throw new CheckpointNotFoundError(latestKey);
    }

    return this.resumeCheckpoint(agentName, checkpoint, options);
  }

  private async saveInFlightCheckpoint(
    context: AgentContext,
    checkpoint: InFlightCheckpoint,
  ): Promise<void> {
    const store = this.options.stateStore ?? this.stateStore;
    if (!store) return;

    const baseKey = this.sessionKey(context);
    const executionKey = `checkpoint:${baseKey}:${checkpoint.executionId}`;
    const latestKey = `checkpoint:latest:${baseKey}`;
    const ttl = this.options.checkpointTtlSeconds ?? DEFAULT_CHECKPOINT_TTL_SECONDS;

    try {
      await store.set(executionKey, checkpoint, ttl);
      await store.set(latestKey, checkpoint, ttl);
    } catch {
      // Best-effort in-flight persistence
    }
  }
}
