

import type { AgentContext } from './agent-context.interface';

/** Schema of a single tool parameter exposed to the LLM. */
export interface ToolParamSchema {
  name: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
}

/**
 * Input passed by a RuntimeAdapter when invoking a tool.
 * AgentContext is NOT included here — it is pre-bound into the closure
 * by LocalToolProvider so it never reaches the adapter or the LLM.
 */
export interface ToolExecutionInput {
  args: Record<string, unknown>;
  /**
   * Identifier of the model tool call this invocation corresponds to, when
   * known. Threaded through so a suspended `require_approval` result can be
   * correlated back to the exact conversation entry it withheld.
   */
  toolCallId?: string;
}

export type ToolExecutionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; status: 'denied'; reason: string }
  | { success: false; status: 'pending_approval'; reason: string; approvalId: string };

/**
 * A tool fully resolved with its policy closure — ready to be handed
 * to a RuntimeAdapter without any further NestJS knowledge required.
 */
export interface ResolvedTool {
  name: string;
  description: string;
  parameters: ToolParamSchema[];
  execute(input: ToolExecutionInput): Promise<ToolExecutionResult>;
}

/**
 * Contract for dynamic tool sources (e.g. MCP servers, remote RPC, plugin catalogs).
 * Supplies executable tool definitions bound to the current execution context.
 */
export interface ToolProvider {
  /**
   * Resolves executable tool definitions for the current agent context.
   */
  getTools(context: AgentContext, agentName?: string): Promise<ResolvedTool[]> | ResolvedTool[];

  /**
   * Directly invokes an already-approved tool call, bypassing policy evaluation.
   * Optional hook for providers participating in Human-in-the-Loop (HITL) workflows.
   */
  invokeApprovedTool?(
    toolName: string,
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolExecutionResult>;
}

/** Narrows an unknown token or instance to a valid `ToolProvider`. */
export function isToolProvider(value: unknown): value is ToolProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ToolProvider).getTools === 'function'
  );
}

/** Record of a single tool call made during an agent run. */
export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
}
