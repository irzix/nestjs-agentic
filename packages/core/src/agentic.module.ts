import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import {
  AGENT_PROVIDERS,
  AGENTIC_OPTIONS,
  APPROVAL_STORE,
  POLICY_INSTANCES,
  SESSION_STORE,
} from './constants';
import { ToolDiscoveryService } from './discovery/tool-discovery.service';
import type { AgentProvider, ToolPolicy } from './interfaces';
import { LocalToolProvider } from './providers/local-tool.provider';
import { AgentRunner, AgenticModuleOptions } from './services/agent-runner.service';
import { ApprovalService } from './services/approval.service';
import { InMemoryApprovalStore } from './stores/in-memory-approval.store';
import { InMemorySessionStore } from './stores/in-memory-session.store';

export interface ForFeatureOptions {
  /** Agent provider classes to register. Each must be decorated with @Agent(). */
  agents?: Type<AgentProvider>[];
  /** ToolSet classes to register. Each must be decorated with @ToolSet(). */
  toolSets?: Type<object>[];
  /**
   * Policy classes to register. Each must implement ToolPolicy and be
   * referenced in @UsePolicies() on a @Tool method or @ToolSet class.
   */
  policies?: Type<ToolPolicy>[];
}

/** Core services provided globally by forRoot(). */
const CORE_PROVIDERS: Provider[] = [
  ToolDiscoveryService,
  LocalToolProvider,
  AgentRunner,
  ApprovalService,
  { provide: APPROVAL_STORE, useClass: InMemoryApprovalStore },
  { provide: SESSION_STORE, useClass: InMemorySessionStore },
];

@Module({})
export class AgenticModule {
  /**
   * Registers core services globally. Call once in the root AppModule.
   * Registers default in-memory stores which can be overridden per-module
   * via { provide: APPROVAL_STORE, useClass: RedisApprovalStore }.
   */
  static forRoot(options: AgenticModuleOptions): DynamicModule {
    return {
      module: AgenticModule,
      global: true,
      providers: [
        { provide: AGENTIC_OPTIONS, useValue: options },
        ...CORE_PROVIDERS,
      ],
      exports: [
        AgentRunner,
        ApprovalService,
        LocalToolProvider,
        ToolDiscoveryService,
        APPROVAL_STORE,
        SESSION_STORE,
      ],
    };
  }

  /**
   * Registers agents, tool sets, and policies for a feature module.
   * Can be called multiple times across different modules — providers are
   * accumulated via multi-tokens (AGENT_PROVIDERS, POLICY_INSTANCES).
   */
  static forFeature(options: ForFeatureOptions): DynamicModule {
    const agentProviders: Provider[] = (options.agents ?? []).flatMap((AgentClass) => [
      { provide: AgentClass, useClass: AgentClass },
      { provide: AGENT_PROVIDERS, useExisting: AgentClass, multi: true },
    ]);

    const toolSetProviders: Provider[] = (options.toolSets ?? []).map((ToolSetClass) => ({
      provide: ToolSetClass,
      useClass: ToolSetClass,
    }));

    const policyProviders: Provider[] = (options.policies ?? []).flatMap((PolicyClass) => [
      { provide: PolicyClass, useClass: PolicyClass },
      { provide: POLICY_INSTANCES, useExisting: PolicyClass, multi: true },
    ]);

    const allProviders = [...agentProviders, ...toolSetProviders, ...policyProviders];

    const exportedTokens = [
      ...(options.agents ?? []),
      ...(options.toolSets ?? []),
      ...(options.policies ?? []),
      AGENT_PROVIDERS,
      POLICY_INSTANCES,
    ];

    return {
      module: AgenticModule,
      providers: allProviders,
      exports: exportedTokens,
    };
  }
}
