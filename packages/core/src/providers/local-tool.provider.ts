import { Inject, Injectable, Optional } from '@nestjs/common';
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
  private readonly policyMap: Map<Function, ToolPolicy>;

  constructor(
    @Optional() @Inject(POLICY_INSTANCES) policyInstances: ToolPolicy[],
    @Inject(APPROVAL_STORE) private readonly approvalStore: ApprovalStore,
    private readonly discovery: ToolDiscoveryService,
  ) {
    this.policyMap = new Map(
      (policyInstances ?? []).map((p) => [p.constructor as Function, p]),
    );
  }

  /**
   * Scans each @ToolSet instance, discovers its @Tool methods, and wraps
   * each one in a ResolvedTool closure with policy enforcement and
   * AgentContext pre-bound. The adapter only needs to supply tool args.
   */
  buildTools(toolSetInstances: object[], agentContext: AgentContext): ResolvedTool[] {
    return toolSetInstances.flatMap((instance) => {
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
        // --- Policy evaluation (context is pre-bound, never sent to LLM) ---
        for (const Constructor of allPolicyConstructors) {
          const policy = this.policyMap.get(Constructor);

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

        // --- Method invocation ---
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
