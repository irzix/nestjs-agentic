import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { APPROVAL_STORE, POLICY_INSTANCES } from '../constants';
import { ToolDiscoveryService } from '../discovery/tool-discovery.service';
import type { DiscoveredTool } from '../discovery/tool-discovery.service';
import type {
  ApprovalStore,
  ResolvedTool,
  ToolExecutionInput,
  ToolExecutionResult,
  ToolParamSchema,
  ToolPolicy,
} from '../interfaces';

type PolicyConstructor = new (...args: unknown[]) => ToolPolicy;

@Injectable()
export class LocalToolProvider {
  private readonly policyMap: Map<Function, ToolPolicy>;

  constructor(
    @Inject(POLICY_INSTANCES) policyInstances: ToolPolicy[],
    @Inject(APPROVAL_STORE) private readonly approvalStore: ApprovalStore,
    private readonly discovery: ToolDiscoveryService,
  ) {
    this.policyMap = new Map(
      (policyInstances ?? []).map((p) => [p.constructor as Function, p]),
    );
  }

  /**
   * Scans each @ToolSet instance, discovers its @Tool methods,
   * and wraps each one in a ResolvedTool closure with policy enforcement baked in.
   */
  buildTools(toolSetInstances: object[]): ResolvedTool[] {
    return toolSetInstances.flatMap((instance) => {
      const discovered = this.discovery.discover(instance);
      if (!discovered) return [];

      return discovered.tools.map((tool) =>
        this.buildResolvedTool(tool, discovered.classPolicyConstructors),
      );
    });
  }

  private buildResolvedTool(
    tool: DiscoveredTool,
    classPolicyConstructors: PolicyConstructor[],
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
      execute: async (input: ToolExecutionInput): Promise<ToolExecutionResult> => {
        // --- Policy evaluation ---
        for (const Constructor of allPolicyConstructors) {
          const policy = this.policyMap.get(Constructor);

          if (!policy) {
            throw new Error(
              `Policy "${Constructor.name}" is not registered. ` +
                `Add it to AgenticModule.forFeature({ policies: [${Constructor.name}] }).`,
            );
          }

          const result = await policy.evaluate(input.context, tool.toolName, input.args);

          if (result.decision === 'deny') {
            return { success: false, status: 'denied', reason: result.reason };
          }

          if (result.decision === 'require_approval') {
            const approvalId = randomUUID();
            await this.approvalStore.save({
              id: approvalId,
              toolName: tool.toolName,
              args: input.args,
              context: input.context,
              reason: result.reason,
              createdAt: new Date(),
              execute: () => this.invokeMethod(tool, input),
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
        return this.invokeMethod(tool, input);
      },
    };
  }

  private async invokeMethod(
    tool: DiscoveredTool,
    input: ToolExecutionInput,
  ): Promise<ToolExecutionResult> {
    const methodArgs: unknown[] = [];

    for (const param of tool.params) {
      methodArgs[param.index] = input.args[param.name];
    }

    if (tool.contextParamIndex !== undefined) {
      methodArgs[tool.contextParamIndex] = input.context;
    }

    const data = await (
      tool.instance as Record<string, (...args: unknown[]) => Promise<unknown>>
    )[tool.methodName](...methodArgs);

    return { success: true, data };
  }
}
