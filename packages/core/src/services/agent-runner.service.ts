import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { AGENT_METADATA, AGENT_PROVIDERS, AGENTIC_OPTIONS, RUNTIME_ADAPTER } from '../constants';
import { RuntimeNotConfiguredError } from '../errors';
import { LocalToolProvider } from '../providers/local-tool.provider';
import type {
  AgentConfig,
  AgentContext,
  AgentProvider,
  AgentResult,
  AgentStreamEvent,
  ModelConfig,
  ResolvedTool,
  RuntimeAdapter,
} from '../interfaces';
import type {
  ExecutionLimits,
  ToolErrorHandling,
} from '../interfaces/execution.interface';
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
  ) {}

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
      tools: this.localToolProvider.buildTools(config.tools, context),
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
