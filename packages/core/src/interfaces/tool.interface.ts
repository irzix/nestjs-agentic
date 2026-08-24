

import type { AgentContext } from './agent-context.interface';
import type { Provenance } from './provenance.interface';

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
  | {
      success: true;
      data: T;
      /**
       * Provenance label for the tool's output. Populated by `LocalToolProvider`
       * as `{ source: 'tool', origin: <toolName> }`. Optional and purely additive:
       * consumers that ignore it are unaffected.
       */
      provenance?: Provenance;
    }
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

  /**
   * Optional hook letting a provider run its Output Rail policies
   * (`ToolPolicy.evaluateOutput`) against a tool's error message before it's
   * reported to the model. Only called on the `toolErrorHandling: 'report'`
   * path — `'throw'` mode ends the run before this would ever run, so the
   * original exception is never altered by it. Providers without output
   * rails (e.g. MCP tool providers) can omit this; the raw, truncated
   * message is used as-is.
   *
   * @param rawMessage The tool's thrown error message, before truncation.
   * @param args The arguments the tool was called with, for policies that
   * key their audit records or decisions off them.
   * @returns The sanitized (or unmodified) message to report to the model.
   * A rejected promise is treated as a sanitization failure by the caller,
   * which fails closed rather than forwarding `rawMessage` unsanitized.
   */
  sanitizeErrorMessage?(rawMessage: string, args: Record<string, unknown>): Promise<string>;
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
