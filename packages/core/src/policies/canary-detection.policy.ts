import type { AgentContext, PolicyOutputResult, PolicyResult, ToolPolicy } from '../interfaces';

/**
 * Options for configuring CanaryDetectionPolicy.
 */
export interface CanaryDetectionPolicyOptions {
  /**
   * List of secret canary tokens embedded into system prompts to trap prompt leakage.
   */
  canaryTokens?: string[];

  /** Custom rejection message returned when a canary token is detected. */
  denyReason?: string;
}

/**
 * Built-in Security Guardrail policy detecting prompt exfiltration and indirect injection attacks
 * using Canary Token Traps.
 *
 * Intercepts tool calls and tool outputs to ensure private system prompt tokens
 * are never exfiltrated to external destinations or reasoning transcripts.
 *
 * @see Greshake et al. (USENIX Security 2023, arXiv:2302.12173)
 * @see Rebedea et al. (NVIDIA NeMo Guardrails, arXiv:2310.10501)
 *
 * @example
 * ```typescript
 * @Tool({ name: 'send_http_request' })
 * @UsePolicies(new CanaryDetectionPolicy({ canaryTokens: ['CANARY_SECRET_TOKEN_99'] }))
 * async sendHttpRequest() { ... }
 * ```
 */
export class CanaryDetectionPolicy implements ToolPolicy {
  private readonly canaryTokens: string[];
  private readonly denyReason: string;

  constructor(options?: CanaryDetectionPolicyOptions) {
    this.canaryTokens = options?.canaryTokens ?? [];
    this.denyReason =
      options?.denyReason ??
      'Canary token leakage detected: Potential prompt exfiltration attack blocked.';
  }

  /**
   * Evaluates tool arguments to ensure the model was not coerced into passing canary tokens to external tools.
   */
  async evaluate(
    _ctx: AgentContext,
    _toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    if (this.canaryTokens.length === 0) {
      return { decision: 'allow' };
    }

    if (this.containsCanary(args)) {
      return {
        decision: 'deny',
        reason: 'Canary token exfiltration blocked: Attempt to leak prompt canary token in tool arguments.',
      };
    }

    return { decision: 'allow' };
  }

  /**
   * Evaluates tool output to ensure malicious third-party payloads did not reflect or expose canary tokens.
   */
  async evaluateOutput(
    _ctx: AgentContext,
    _toolName: string,
    result: unknown,
  ): Promise<PolicyOutputResult> {
    if (this.canaryTokens.length === 0 || result === undefined || result === null) {
      return { decision: 'allow' };
    }

    if (this.containsCanary(result)) {
      return {
        decision: 'deny',
        reason: this.denyReason,
      };
    }

    return { decision: 'allow' };
  }

  private containsCanary(value: unknown): boolean {
    if (typeof value === 'string') {
      return this.canaryTokens.some((token) => value.includes(token));
    }

    if (Array.isArray(value)) {
      return value.some((item) => this.containsCanary(item));
    }

    if (typeof value === 'object' && value !== null) {
      return Object.values(value as Record<string, unknown>).some((v) =>
        this.containsCanary(v),
      );
    }

    return false;
  }
}
