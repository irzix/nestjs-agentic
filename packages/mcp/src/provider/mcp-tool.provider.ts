import type {
  AgentContext,
  ResolvedTool,
  ToolExecutionInput,
  ToolExecutionResult,
  ToolPolicy,
  ToolProvider,
} from '@nestjs-agentic/core';
import { ApprovalToolNotFoundError } from '@nestjs-agentic/core';
import type { McpClient } from '../client/mcp-client';
import type { McpToolSchema } from '../interfaces/mcp.interface';
import { mcpSchemaToToolParams, validateGorillaPreConditions } from '../utils/schema-converter';

export interface McpToolProviderOptions {
  client: McpClient;
  policies?: ToolPolicy[];
}

/**
 * Bridges Model Context Protocol (MCP) tool definitions into NestJS-Agentic's `ResolvedTool[]` interface.
 * Implements deterministic parameter pre-validation (Gorilla), policy evaluation, and execution unwrapping.
 */
export class McpToolProvider implements ToolProvider {
  private readonly client: McpClient;
  private readonly policies: ToolPolicy[];

  constructor(options: McpToolProviderOptions) {
    this.client = options.client;
    this.policies = options.policies ?? [];
  }

  /**
   * Discovers tools from the MCP server and constructs policy-wrapped `ResolvedTool[]` instances.
   */
  async getTools(agentContext: AgentContext): Promise<ResolvedTool[]> {
    const mcpTools = await this.client.listTools();
    return mcpTools.map((tool) => this.buildResolvedTool(tool, agentContext));
  }

  /**
   * Directly invokes an already-approved tool call, bypassing policy evaluation.
   */
  async invokeApprovedTool(
    toolName: string,
    args: Record<string, unknown>,
    agentContext: AgentContext
  ): Promise<ToolExecutionResult> {
    const mcpTools = await this.client.listTools();
    const tool = mcpTools.find((t) => t.name === toolName);

    if (!tool) {
      throw new ApprovalToolNotFoundError(toolName);
    }

    try {
      const activeSignal = agentContext.signal;
      const callResult = await this.client.callTool(tool.name, args, activeSignal);

      const textBlocks = callResult.content.filter((c) => c.type === 'text');
      const outputData =
        textBlocks.length === 1
          ? textBlocks[0].text
          : textBlocks.length > 1
            ? textBlocks.map((b) => b.text).join('\n\n')
            : callResult.content;

      return {
        success: true,
        data: outputData,
      };
    } catch (execErr: unknown) {
      const message = (execErr as Error).message || 'MCP tool execution failed';
      return {
        success: false,
        status: 'denied',
        reason: message,
      };
    }
  }

  /**
   * Constructs a single `ResolvedTool` instance for a given MCP tool schema.
   */
  buildResolvedTool(tool: McpToolSchema, agentContext: AgentContext): ResolvedTool {
    const parameters = mcpSchemaToToolParams(tool.inputSchema);

    return {
      name: tool.name,
      description: tool.description ?? `Remote tool "${tool.name}" on MCP server "${this.client.serverName}"`,
      parameters,
      execute: async (input: ToolExecutionInput): Promise<ToolExecutionResult> => {
        const args = input.args ?? {};

        // 1. Gorilla Deterministic Pre-conditions Validation
        try {
          validateGorillaPreConditions(this.client.serverName, tool.name, tool.inputSchema, args);
        } catch (validationErr: unknown) {
          const errMessage = (validationErr as Error).message;
          return {
            success: false,
            status: 'denied',
            reason: `Pre-validation failed: ${errMessage}`,
          };
        }

        // 2. Policy Evaluation Pipeline (RBAC, Tenant Isolation, Audit)
        for (const policy of this.policies) {
          if (policy.evaluate) {
            const decision = await policy.evaluate(agentContext, tool.name, args);

            if (decision.decision === 'deny') {
              return {
                success: false,
                status: 'denied',
                reason: decision.reason,
              };
            }

            if (decision.decision === 'require_approval') {
              return {
                success: false,
                status: 'pending_approval',
                reason: decision.reason,
                approvalId: `mcp_appr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              };
            }
          }
        }

        // 3. Dispatch to remote MCP server over transport
        try {
          const activeSignal = agentContext.signal;
          const callResult = await this.client.callTool(tool.name, args, activeSignal);

          // Extract text content and data payload
          const textBlocks = callResult.content.filter((c) => c.type === 'text');
          const outputData =
            textBlocks.length === 1
              ? textBlocks[0].text
              : textBlocks.length > 1
                ? textBlocks.map((b) => b.text).join('\n\n')
                : callResult.content;

          return {
            success: true,
            data: outputData,
          };
        } catch (execErr: unknown) {
          const message = (execErr as Error).message || 'MCP tool execution failed';
          return {
            success: false,
            status: 'denied',
            reason: message,
          };
        }
      },
    };
  }
}
