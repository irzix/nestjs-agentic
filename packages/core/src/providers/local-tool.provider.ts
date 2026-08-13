import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { APPROVAL_STORE, POLICY_INSTANCES } from '../constants';
import { ApprovalToolNotFoundError, PolicyNotRegisteredError } from '../errors';
import { ToolDiscoveryService } from '../discovery/tool-discovery.service';
import type { DiscoveredTool } from '../discovery/tool-discovery.service';
import type {
  AgentContext,
  ApprovalStore,
  ResolvedTool,
  ToolExecutionResult,
  ToolParamSchema,
  ToolPolicy,
} from '../interfaces';

type PolicyConstructor = new (...args: unknown[]) => ToolPolicy;

@Injectable()
export class LocalToolProvider {
  constructor(
    @Optional() @Inject(POLICY_INSTANCES) private readonly policyInstances: ToolPolicy[],
    @Inject(APPROVAL_STORE) private readonly approvalStore: ApprovalStore,
    private readonly discovery: ToolDiscoveryService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private getPolicyMap(): Map<Function | string, ToolPolicy> {
    let instances = Array.isArray(this.policyInstances) ? this.policyInstances : [];
    if (instances.length === 0) {
      try {
        instances = this.moduleRef.get(POLICY_INSTANCES, { strict: false, each: true });
      } catch {
        instances = [];
      }
    }
    const list = Array.isArray(instances) ? instances : [instances];
    const map = new Map<Function | string, ToolPolicy>();
    for (const p of list) {
      if (p?.constructor) {
        map.set(p.constructor, p);
        map.set(p.constructor.name, p);
      }
    }
    return map;
  }

  private resolvePolicy(
    Constructor: PolicyConstructor,
    policyMap: Map<Function | string, ToolPolicy>,
  ): ToolPolicy | undefined {
    const existing = policyMap.get(Constructor) ?? policyMap.get(Constructor.name);
    if (existing) {
      return existing;
    }

    try {
      return this.moduleRef.get(Constructor, { strict: false });
    } catch {
      return undefined;
    }
  }

  /**
   * Builds policy-guarded tool closures for one agent turn.
   * `agentName` is stored on any `PendingApproval` created while executing
   * these tools, so a later resume can re-resolve the same agent's tool set
   * through DI instead of closing over live instances.
   */
  buildTools(
    toolSetTokensOrInstances: (object | Function)[],
    agentContext: AgentContext,
    agentName = '',
  ): ResolvedTool[] {
    return toolSetTokensOrInstances.flatMap((tokenOrInstance) => {
      const instance = this.resolveInstance(tokenOrInstance);
      if (!instance) return [];

      const discovered = this.discovery.discover(instance);
      if (!discovered) return [];

      return discovered.tools.map((tool) =>
        this.buildResolvedTool(tool, discovered.classPolicyConstructors, agentContext, agentName),
      );
    });
  }

  /**
   * Invokes a tool method directly, bypassing policy evaluation.
   *
   * Used to resolve an already-approved `PendingApproval`: the policy that
   * required approval already ran once, and a human decision now stands in
   * for it. Any policies declared after it in the chain were never evaluated
   * originally and are not evaluated here either, matching prior behavior.
   */
  async invokeApprovedTool(
    toolSetTokensOrInstances: (object | Function)[],
    toolName: string,
    args: Record<string, unknown>,
    agentContext: AgentContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.discoverToolByName(toolSetTokensOrInstances, toolName);
    if (!tool) {
      throw new ApprovalToolNotFoundError(toolName);
    }
    return this.invokeMethod(tool, args, agentContext);
  }

  private discoverToolByName(
    toolSetTokensOrInstances: (object | Function)[],
    toolName: string,
  ): DiscoveredTool | undefined {
    for (const tokenOrInstance of toolSetTokensOrInstances) {
      const instance = this.resolveInstance(tokenOrInstance);
      if (!instance) continue;

      const discovered = this.discovery.discover(instance);
      const match = discovered?.tools.find((t) => t.toolName === toolName);
      if (match) return match;
    }
    return undefined;
  }

  private resolveInstance(tokenOrInstance: object | Function): object | undefined {
    if (typeof tokenOrInstance !== 'function') {
      return tokenOrInstance;
    }

    let instance: object | undefined;
    try {
      instance = this.moduleRef.get(tokenOrInstance as any, { strict: false });
    } catch {
      instance = undefined;
    }
    if (!instance) {
      try {
        instance = new (tokenOrInstance as any)();
      } catch {
        instance = undefined;
      }
    }
    return instance;
  }

  private buildResolvedTool(
    tool: DiscoveredTool,
    classPolicyConstructors: PolicyConstructor[],
    agentContext: AgentContext,
    agentName: string,
  ): ResolvedTool {
    const allPolicyConstructors = [...classPolicyConstructors, ...tool.policyConstructors];

    const parameters: ToolParamSchema[] = tool.params.map((p) => ({
      name: p.name,
      description: p.description,
      type: p.type,
      required: p.required,
    }));

    return {
      name: tool.toolName,
      description: tool.description,
      parameters,
      execute: async ({
        args,
        toolCallId,
      }: {
        args: Record<string, unknown>;
        toolCallId?: string;
      }): Promise<ToolExecutionResult> => {
        const policyMap = this.getPolicyMap();

        for (const Constructor of allPolicyConstructors) {
          const policy = this.resolvePolicy(Constructor, policyMap);

          if (!policy) {
            throw new PolicyNotRegisteredError(Constructor.name);
          }

          const result = await policy.evaluate(agentContext, tool.toolName, args);

          if (result.decision === 'deny') {
            return { success: false, status: 'denied', reason: result.reason };
          }

          if (result.decision === 'require_approval') {
            const approvalId = randomUUID();
            await this.approvalStore.save({
              id: approvalId,
              agentName,
              toolName: tool.toolName,
              args,
              context: agentContext,
              reason: result.reason,
              createdAt: new Date(),
              toolCallId,
            });
            return {
              success: false,
              status: 'pending_approval',
              reason: result.reason,
              approvalId,
            };
          }
        }

        return this.invokeMethod(tool, args, agentContext);
      },
    };
  }

  private async invokeMethod(
    tool: DiscoveredTool,
    args: Record<string, unknown>,
    agentContext: AgentContext,
  ): Promise<ToolExecutionResult> {
    const methodArgs: unknown[] = [];

    for (const param of tool.params) {
      methodArgs[param.index] = args[param.name];
    }

    if (tool.contextParamIndex !== undefined) {
      methodArgs[tool.contextParamIndex] = agentContext;
    }

    const data = await (
      tool.instance as Record<string, (...args: unknown[]) => Promise<unknown>>
    )[tool.methodName](...methodArgs);

    return { success: true, data };
  }
}
