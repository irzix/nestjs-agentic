import { Inject, Injectable, Optional } from '@nestjs/common';
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
  private readonly agentMap: Map<string, AgentProvider>;

  constructor(
    @Optional() @Inject(AGENT_PROVIDERS) agentProviders: AgentProvider[],
    @Inject(RUNTIME_ADAPTER) private readonly runtimeAdapter: RuntimeAdapter,
    @Inject(AGENTIC_OPTIONS) private readonly options: AgenticModuleOptions,
    private readonly localToolProvider: LocalToolProvider,
  ) {
    this.agentMap = new Map(
      (agentProviders ?? []).map((agent) => {
        const metadata: { name: string } = Reflect.getMetadata(
          AGENT_METADATA,
          agent.constructor,
        );
        return [metadata.name, agent];
      }),
    );
  }

  /**
   * Resolves the named agent, builds its tools with policy closures,
   * and delegates execution to the registered RuntimeAdapter.
   */
  async run(agentName: string, input: RunInput): Promise<AgentResult> {
    const agent = this.agentMap.get(agentName);

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
