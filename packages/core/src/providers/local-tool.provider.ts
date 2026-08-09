import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { APPROVAL_STORE, POLICY_INSTANCES } from '../constants';
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

  buildTools(toolSetTokensOrInstances: (object | Function)[], agentContext: AgentContext): ResolvedTool[] {
    return toolSetTokensOrInstances.flatMap((tokenOrInstance) => {
      let instance: object | undefined;
      if (typeof tokenOrInstance === 'function') {
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
      } else {
        instance = tokenOrInstance;
      }

      if (!instance) return [];

      const discovered = this.discovery.discover(instance);
      if (!discovered) return [];

      return discovered.tools.map((tool) =>
        this.buildResolvedTool(tool, discovered.classPolicyConstructors, agentContext),
      );
    });
  }

  private buildResolvedTool(
    tool: DiscoveredTool,
    classPolicyConstructors: PolicyConstructor[],
    agentContext: AgentContext,
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
      execute: async ({ args }: { args: Record<string, unknown> }): Promise<ToolExecutionResult> => {
        const policyMap = this.getPolicyMap();

        for (const Constructor of allPolicyConstructors) {
          const policy = this.resolvePolicy(Constructor, policyMap);

          if (!policy) {
            throw new Error(
              `Policy "${Constructor.name}" is not registered. ` +
                `Add it to AgenticModule.forFeature({ policies: [${Constructor.name}] }).`,
            );
          }

          const result = await policy.evaluate(agentContext, tool.toolName, args);

          if (result.decision === 'deny') {
            return { success: false, status: 'denied', reason: result.reason };
          }

          if (result.decision === 'require_approval') {
            const approvalId = randomUUID();
            await this.approvalStore.save({
              id: approvalId,
              toolName: tool.toolName,
              args,
              context: agentContext,
              reason: result.reason,
              createdAt: new Date(),
              execute: () => this.invokeMethod(tool, args, agentContext),
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
