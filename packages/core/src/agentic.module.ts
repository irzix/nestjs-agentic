import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import {
  AGENT_OBSERVERS,
  AGENT_PROVIDERS,
  AGENTIC_OPTIONS,
  APPROVAL_AUTHORIZER,
  APPROVAL_STORE,
  AUDIT_SINKS,
  IDEMPOTENCY_STORE,
  POLICY_INSTANCES,
  SESSION_STORE,
} from './constants';
import { ToolDiscoveryService } from './discovery/tool-discovery.service';
import type {
  AgentProvider,
  ApprovalAuthorizerRegistration,
  ToolPolicy,
  StateStore,
} from './interfaces';
import { MODEL_ADAPTER } from './interfaces/model.interface';
import { STATE_STORE } from './interfaces/state-store.interface';
import { LocalToolProvider } from './providers/local-tool.provider';
import { AgentExecutor } from './services/agent-executor.service';
import { AgentRunner, AgenticModuleOptions } from './services/agent-runner.service';
import { ApprovalService } from './services/approval.service';
import { AuditTrail } from './services/audit-trail.service';
import {
  InMemoryApprovalStore,
  InMemoryIdempotencyStore,
  InMemorySessionStore,
  InMemoryStateStore,
} from './stores';

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
];

@Module({})
export class AgenticModule {
  /**
   * Registers core services globally. Call once in the root AppModule.
   * Registers default in-memory stores which can be overridden per-module
   * via options or custom tokens.
   */
  static forRoot(options: AgenticModuleOptions): DynamicModule {
    const stateStoreProvider: Provider = options.stateStore
      ? { provide: STATE_STORE, useValue: options.stateStore }
      : { provide: STATE_STORE, useClass: InMemoryStateStore };

    const approvalStoreProvider: Provider = options.approvalStore
      ? { provide: APPROVAL_STORE, useValue: options.approvalStore }
      : { provide: APPROVAL_STORE, useClass: InMemoryApprovalStore };

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

    // Observers receive runtime lifecycle hooks, OpenTelemetry spans, and metrics.
    const observerProviders: Provider[] = options.observers?.length
      ? [{ provide: AGENT_OBSERVERS, useValue: options.observers }]
      : [];

    // Registered here because ApprovalService is instantiated inside this module:
    // a provider declared in the importing module is not visible to it.
    const approvalAuthorizerProviders: Provider[] = options.approvalAuthorizer
      ? [toApprovalAuthorizerProvider(options.approvalAuthorizer)]
      : [];

    return {
      module: AgenticModule,
      global: true,
      providers: [
        { provide: AGENTIC_OPTIONS, useValue: options },
        stateStoreProvider,
        approvalStoreProvider,
        sessionStoreProvider,
        idempotencyStoreProvider,
        ...modelAdapterProviders,
        ...auditSinkProviders,
        ...observerProviders,
        ...approvalAuthorizerProviders,
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

/**
 * Translates an authorizer registration into a Nest provider, so `useClass` and
 * `useFactory` forms are constructed by the container and can inject their own
 * dependencies. A bare instance is registered as a value.
 */
function toApprovalAuthorizerProvider(
  registration: ApprovalAuthorizerRegistration,
): Provider {
  if (typeof registration === 'object' && registration !== null) {
    if ('useClass' in registration) {
      return { provide: APPROVAL_AUTHORIZER, useClass: registration.useClass };
    }
    if ('useFactory' in registration) {
      return {
        provide: APPROVAL_AUTHORIZER,
        useFactory: registration.useFactory,
        inject: registration.inject,
      };
    }
  }
  return { provide: APPROVAL_AUTHORIZER, useValue: registration };
}
