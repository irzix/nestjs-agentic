import type { AgentContext } from './agent-context.interface';
import type { Provenance } from './provenance.interface';

/**
 * 3-State policy evaluation decision result returned by a ToolPolicy before tool execution.
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
 * Result returned by a ToolPolicy's post-execution output evaluation hook (Output Rails).
 * - `allow`: Output is safe and passed through unmodified.
 * - `deny`: Output is blocked; returns failure reason to the model without revealing output.
 * - `sanitize`: Output is sanitized/redacted before being returned to the model reasoning loop.
 */
export type PolicyOutputResult =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'sanitize'; sanitizedResult: unknown };

/**
 * Interface defining a governance policy executed before and optionally after tool calls.
 * 
 * Supports the Tri-Rail Guardrails architecture (Input, Execution, and Output Rails).
 * @see Rebedea et al. (NVIDIA NeMo Guardrails, arXiv:2310.10501)
 * @see Greshake et al. (USENIX Security 2023, arXiv:2302.12173)
 */
export interface ToolPolicy {
  /**
   * Evaluates the tool call request before execution (Input and Execution Rails).
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

  /**
   * Post-execution policy hook evaluating and sanitizing tool output before returning to the model (Output Rails).
   *
   * @param ctx Captured execution context containing security metadata and session ID.
   * @param toolName Name of the tool method invoked.
   * @param result Raw output data returned by the tool method execution.
   * @param provenance Optional trust/origin label for the output (e.g. `{ source: 'tool' }`),
   *   letting a policy make trust-aware decisions. Undefined when the caller has no label.
   * @returns Promise resolving to PolicyOutputResult (allow, deny, or sanitize).
   */
  evaluateOutput?(
    ctx: AgentContext,
    toolName: string,
    result: unknown,
    provenance?: Provenance,
  ): Promise<PolicyOutputResult>;
}
