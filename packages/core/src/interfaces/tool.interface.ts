

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
 * Contract for any source that can supply resolved tools.
 * Implementations include LocalToolProvider (decorator-based),
 * and future providers such as MCP or HTTP remotes.
 */
export interface ToolProvider {
  getTools(): ResolvedTool[];
}

/** Record of a single tool call made during an agent run. */
export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
}
