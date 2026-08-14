import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import {
  AGENT_PROVIDERS,
  AGENTIC_OPTIONS,
  APPROVAL_STORE,
  AUDIT_SINKS,
  IDEMPOTENCY_STORE,
  POLICY_INSTANCES,
  SESSION_STORE,
} from './constants';
import { ToolDiscoveryService } from './discovery/tool-discovery.service';
import type { AgentProvider, ToolPolicy, StateStore } from './interfaces';
import { MODEL_ADAPTER } from './interfaces/model.interface';
import { STATE_STORE } from './interfaces/state-store.interface';
import { LocalToolProvider } from './providers/local-tool.provider';
import { AgentExecutor } from './services/agent-executor.service';
import { AgentRunner, AgenticModuleOptions } from './services/agent-runner.service';
import { ApprovalService } from './services/approval.service';
import { AuditTrail } from './services/audit-trail.service';
import { InMemoryApprovalStore } from './stores/in-memory-approval.store';
import { InMemoryIdempotencyStore } from './stores/in-memory-idempotency.store';
import { InMemorySessionStore } from './stores/in-memory-session.store';
import { InMemoryStateStore } from './stores/in-memory-state.store';

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
  AgentExecutor,
  AgentRunner,
  ApprovalService,
  AuditTrail,
  { provide: APPROVAL_STORE, useClass: InMemoryApprovalStore },
  { provide: SESSION_STORE, useClass: InMemorySessionStore },
  { provide: IDEMPOTENCY_STORE, useClass: InMemoryIdempotencyStore },
];

@Module({})
export class AgenticModule {
  /**
   * Registers core services globally. Call once in the root AppModule.
   * Registers default in-memory stores which can be overridden per-module
   * via { provide: APPROVAL_STORE, useClass: RedisApprovalStore } or stateStore in options.
   */
  static forRoot(options: AgenticModuleOptions): DynamicModule {
    const stateStoreProvider: Provider = options.stateStore
      ? { provide: STATE_STORE, useValue: options.stateStore }
      : { provide: STATE_STORE, useClass: InMemoryStateStore };

    const sessionStoreProvider: Provider = options.sessionStore
      ? { provide: SESSION_STORE, useValue: options.sessionStore }
      : { provide: SESSION_STORE, useClass: InMemorySessionStore };

    const idempotencyStoreProvider: Provider = options.idempotencyStore
      ? { provide: IDEMPOTENCY_STORE, useValue: options.idempotencyStore }
      : { provide: IDEMPOTENCY_STORE, useClass: InMemoryIdempotencyStore };

    // Registering the adapter here keeps it resolvable by AgentExecutor, which is
    // instantiated inside this module rather than in the consuming module.
    const modelAdapterProviders: Provider[] = options.modelAdapter
      ? [{ provide: MODEL_ADAPTER, useValue: options.modelAdapter }]
      : [];

    // Auditing stays opt-in: without a sink the token is left unprovided and
    // AuditTrail records nothing.
    const auditSinkProviders: Provider[] = options.auditSinks?.length
      ? [{ provide: AUDIT_SINKS, useValue: options.auditSinks }]
      : [];

    return {
      module: AgenticModule,
      global: true,
      providers: [
        { provide: AGENTIC_OPTIONS, useValue: options },
        stateStoreProvider,
        sessionStoreProvider,
        idempotencyStoreProvider,
        ...modelAdapterProviders,
        ...auditSinkProviders,
        ...CORE_PROVIDERS,
      ],
      exports: [
        AgentRunner,
        AgentExecutor,
        ApprovalService,
        AuditTrail,
        LocalToolProvider,
        ToolDiscoveryService,
        STATE_STORE,
        APPROVAL_STORE,
        SESSION_STORE,
        IDEMPOTENCY_STORE,
        ...(options.modelAdapter ? [MODEL_ADAPTER] : []),
      ],
    };
  }

  /**
   * Registers agents, tool sets, and policies for a feature module.
   * Can be called multiple times across different modules — providers are
   * accumulated via multi-tokens (AGENT_PROVIDERS, POLICY_INSTANCES).
   */
  static forFeature(options: ForFeatureOptions): DynamicModule {
    const agents = options.agents ?? [];
    const agentClasses: Provider[] = agents.map((AgentClass) => ({
      provide: AgentClass,
      useClass: AgentClass,
    }));

    const agentMultiProvider: Provider[] = agents.length > 0 ? [{
      provide: AGENT_PROVIDERS,
      useFactory: (...instances: any[]) => instances,
      inject: agents,
    }] : [];

    const toolSetProviders: Provider[] = (options.toolSets ?? []).map((ToolSetClass) => ({
      provide: ToolSetClass,
      useClass: ToolSetClass,
    }));

    const policyProviders: Provider[] = (options.policies ?? []).flatMap((PolicyClass) => [
      { provide: PolicyClass, useClass: PolicyClass },
      { provide: POLICY_INSTANCES, useExisting: PolicyClass, multi: true },
    ]);

    const allProviders = [...agentClasses, ...agentMultiProvider, ...toolSetProviders, ...policyProviders];

    const exportedTokens = [
      ...(options.agents ?? []),
      ...(options.toolSets ?? []),
      ...(options.policies ?? []),
      ...((options.agents ?? []).length > 0 ? [AGENT_PROVIDERS] : []),
      ...((options.policies ?? []).length > 0 ? [POLICY_INSTANCES] : []),
    ];

    return {
      module: AgenticModule,
      providers: allProviders,
      exports: [...exportedTokens, AgenticModule],
    };
  }
}
