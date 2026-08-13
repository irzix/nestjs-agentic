import type { AgentContext } from './agent-context.interface';

/**
 * 3-State policy evaluation decision result returned by a ToolPolicy.
 * - `allow`: Tool call is approved for immediate execution.
 * - `deny`: Tool call is rejected; returns failure reason to the agent without executing the tool.
 * - `require_approval`: Tool call requires Human-In-The-Loop approval before execution.
 */
export type PolicyResult =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | {
      decision: 'require_approval';
      reason: string;
      /**
       * Seconds the resulting approval stays valid before it expires. Overrides
       * the module-level `approvalTtlSeconds`. Omit to fall back to the module
       * default, or leave both unset for an approval that never expires.
       */
      ttlSeconds?: number;
    };

/**
 * Interface defining a governance policy executed before every tool call.
 */
export interface ToolPolicy {
  /**
   * Evaluates the tool call request against the policy rules.
   *
   * @param ctx Captured execution context containing security metadata and session ID.
   * @param toolName Name of the tool method being invoked.
   * @param args Dictionary of arguments passed to the tool.
   * @returns Promise resolving to the 3-state PolicyResult decision.
   */
  evaluate(
    ctx: AgentContext,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult>;
}
