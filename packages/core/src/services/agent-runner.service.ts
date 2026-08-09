import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { AGENT_METADATA, AGENT_PROVIDERS, AGENTIC_OPTIONS, RUNTIME_ADAPTER } from '../constants';
import { LocalToolProvider } from '../providers/local-tool.provider';
import type {
  AgentContext,
  AgentProvider,
  AgentResult,
  ModelConfig,
  RuntimeAdapter,
} from '../interfaces';

export interface AgenticModuleOptions {
  defaultModel: ModelConfig;
}

export interface RunInput {
  sessionId: string;
  message: string;
  /**
   * Security and identity data merged into the AgentContext for this run.
   * Typically sourced from the authenticated request (e.g. req.user).
   */
  context?: {
    userId?: string;
    tenantId?: string;
    roles?: string[];
    permissions?: string[];
    data?: Record<string, unknown>;
  };
}

@Injectable()
export class AgentRunner {
  constructor(
    @Optional() @Inject(AGENT_PROVIDERS) private readonly agentProviders: AgentProvider[],
    @Inject(RUNTIME_ADAPTER) private readonly runtimeAdapter: RuntimeAdapter,
    @Inject(AGENTIC_OPTIONS) private readonly options: AgenticModuleOptions,
    private readonly localToolProvider: LocalToolProvider,
    private readonly moduleRef: ModuleRef,
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
    const list = Array.isArray(providers) ? providers : [providers];
    for (const agent of list) {
      if (!agent) continue;
      const metadata: { name: string } =
        Reflect.getMetadata(AGENT_METADATA, agent.constructor) ??
        Reflect.getMetadata(AGENT_METADATA, agent);
      if (metadata?.name) {
        map.set(metadata.name, agent);
      }
    }
    return map;
  }

  /**
   * Resolves the named agent, builds its tools with policy closures,
   * and delegates execution to the registered RuntimeAdapter.
   */
  async run(agentName: string, input: RunInput): Promise<AgentResult> {
    const agentMap = this.getAgentMap();
    const agent = agentMap.get(agentName);

    if (!agent) {
      throw new Error(
        `Agent "${agentName}" is not registered. ` +
          `Add it to AgenticModule.forFeature({ agents: [...] }).`,
      );
    }

    const config = agent.define();
    const model: ModelConfig = config.model ?? this.options.defaultModel;

    const agentContext: AgentContext = {
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

    const tools = this.localToolProvider.buildTools(config.tools, agentContext);

    return this.runtimeAdapter.execute({
      sessionId: input.sessionId,
      message: input.message,
      tools,
      model,
      instructions: config.instructions,
    });
  }
}
