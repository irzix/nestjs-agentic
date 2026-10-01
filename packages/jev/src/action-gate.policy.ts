import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import type { AgentContext, PolicyResult, ToolPolicy } from '@nestjs-agentic/core';
import { askJev, formatProbability } from './ask-jev';
import type { JevCallOptions, JevClient, JevState } from './jev.interface';
import { JEV_CLIENT, JEV_DEFAULTS, type JevDefaults } from './jev.module';

/** What a gate does when Jev cannot answer. */
export type JevActionGateFallback = 'require_approval' | 'deny' | 'allow';

export interface JevActionGateOptions extends JevCallOptions {
  /** Policy name recorded on the audit trail. Default: `'JevActionGate'` */
  name?: string;
  /** Only these tools are judged; any other tool the gate is attached to is allowed. Default: every tool. */
  tools?: string[];
  /**
   * The yes/no question Jev answers about the call. "Yes" must mean the call
   * is safe to run without a human looking at it.
   */
  question?: string;
  /** What "yes" and "no" mean, sharpening Jev's judgment for your domain. */
  criteria?: { true?: string; false?: string };
  /** At or above this probability of "yes", the call runs. Default: `0.9` */
  allowAt?: number;
  /** Below this probability of "yes", the call is refused. Default: `0.1` */
  denyBelow?: number;
  /**
   * Approvers needed for a call in the review band, between `denyBelow` and
   * `allowAt`. A number, or a function of the probability so riskier calls
   * can need more people (dual control). Default: `1`
   */
  requiredApprovals?: number | ((probability: number) => number);
  /** Lifetime of the resulting approval, in seconds. Defaults to the module's `approvalTtlSeconds`. */
  approvalTtlSeconds?: number;
  /**
   * Builds what Jev sees. Defaults to `{ tool, arguments }`. Whatever this
   * returns is sent to the TypeSafe API, so leave out what must not leave
   * your system and add what the judgment needs (the user's role, a spending
   * limit, the conversation goal).
   */
  describe?(ctx: AgentContext, toolName: string, args: Record<string, unknown>): JevState | Promise<JevState>;
  /**
   * Decision when Jev is unreachable, times out, or answers in an unexpected
   * shape. Default: `'require_approval'`, so an outage sends calls to a human
   * rather than letting them through or blocking them outright.
   */
  onError?: JevActionGateFallback;
}

const DEFAULT_QUESTION =
  'Is it safe for an AI agent to perform this tool call without a human reviewing it first?';
const DEFAULT_CRITERIA = {
  true: 'Routine and within normal bounds: the arguments are plausible, the effect is limited or reversible, and nothing suggests misuse.',
  false: 'Risky: destructive or irreversible, unusually large, outside normal bounds, or possibly induced by manipulated input.',
};

/**
 * A `ToolPolicy` that lets Jev decide whether a tool call runs, goes to a
 * human, or is refused, using Jev's calibrated probability that the call is
 * safe to run unreviewed:
 *
 * - `p >= allowAt`: allow
 * - `denyBelow <= p < allowAt`: `require_approval`, with `requiredApprovals` approvers
 * - `p < denyBelow`: deny
 *
 * Every decision reason carries the probability and the thresholds, so the
 * audit trail shows why a call was escalated.
 *
 * Usually created with `JevActionGate(options)`, which returns an injectable
 * class to register through `AgenticModule.forFeature({ policies })`.
 */
export class JevActionGatePolicy implements ToolPolicy {
  private readonly client: JevClient;
  private readonly allowAt: number;
  private readonly denyBelow: number;
  private readonly tools?: Set<string>;

  constructor(
    private readonly options: JevActionGateOptions,
    client?: JevClient,
    private readonly defaults: JevDefaults = {},
  ) {
    const resolved = options.client ?? client;
    if (!resolved) {
      throw new Error(
        `${options.name ?? 'JevActionGate'} has no Jev client: pass \`client\` in its options or import JevModule.forRoot().`,
      );
    }
    this.client = resolved;
    this.allowAt = options.allowAt ?? 0.9;
    this.denyBelow = options.denyBelow ?? 0.1;
    if (!(this.denyBelow >= 0 && this.denyBelow <= this.allowAt && this.allowAt <= 1)) {
      throw new RangeError(
        `Jev gate thresholds must satisfy 0 <= denyBelow <= allowAt <= 1, received denyBelow ${this.denyBelow} and allowAt ${this.allowAt}.`,
      );
    }
    this.tools = options.tools ? new Set(options.tools) : undefined;
  }

  async evaluate(ctx: AgentContext, toolName: string, args: Record<string, unknown>): Promise<PolicyResult> {
    if (this.tools && !this.tools.has(toolName)) {
      return { decision: 'allow' };
    }

    let probability: number;
    try {
      const state = this.options.describe
        ? await this.options.describe(ctx, toolName, args)
        : { tool: toolName, arguments: args };
      const { answers } = await askJev(
        this.client,
        state,
        {
          safe: {
            type: 'noul',
            instructions: this.options.question ?? DEFAULT_QUESTION,
            criteria: this.options.criteria ?? DEFAULT_CRITERIA,
          },
        },
        {
          model: this.options.model ?? this.defaults.model,
          timeoutMs: this.options.timeoutMs ?? this.defaults.timeoutMs,
          signal: ctx.signal,
        },
      );
      probability = answers.safe.noul;
    } catch (err: unknown) {
      return this.fallback(err instanceof Error ? err.message : String(err));
    }

    const p = formatProbability(probability);
    const bounds = `runs unreviewed at >= ${formatProbability(this.allowAt)}, refused below ${formatProbability(this.denyBelow)}`;

    if (probability >= this.allowAt) {
      return { decision: 'allow' };
    }
    if (probability < this.denyBelow) {
      return { decision: 'deny', reason: `Jev judged "${toolName}" unsafe (p(safe)=${p}; ${bounds}).` };
    }

    const required = this.requiredApprovalsFor(probability);
    return {
      decision: 'require_approval',
      reason: `Jev sent "${toolName}" to human review (p(safe)=${p}; ${bounds}).`,
      ...(required > 1 ? { requiredApprovals: required } : {}),
      ...(this.options.approvalTtlSeconds !== undefined ? { ttlSeconds: this.options.approvalTtlSeconds } : {}),
    };
  }

  private requiredApprovalsFor(probability: number): number {
    const setting = this.options.requiredApprovals ?? 1;
    return typeof setting === 'function' ? setting(probability) : setting;
  }

  private fallback(error: string): PolicyResult {
    const mode = this.options.onError ?? 'require_approval';
    if (mode === 'allow') return { decision: 'allow' };
    const reason = `Jev could not judge this call (${error}), so it was ${mode === 'deny' ? 'refused' : 'sent to human review'}.`;
    return mode === 'deny'
      ? { decision: 'deny', reason }
      : {
          decision: 'require_approval',
          reason,
          ...(this.options.approvalTtlSeconds !== undefined ? { ttlSeconds: this.options.approvalTtlSeconds } : {}),
        };
  }
}

/**
 * Creates an injectable Jev action gate class, to register through
 * `AgenticModule.forFeature({ policies })` and attach with `@UsePolicies()`.
 * It uses `options.client` when given, otherwise the client from
 * `JevModule.forRoot()`.
 *
 * @example
 * export const RefundGate = JevActionGate({
 *   name: 'RefundGate',
 *   question: 'Is this refund routine enough to issue without a supervisor?',
 *   allowAt: 0.95,
 *   requiredApprovals: (p) => (p < 0.5 ? 2 : 1),
 * });
 *
 * @UsePolicies(RefundGate)
 * async refund(@Param('amount') amount: number) { ... }
 */
export function JevActionGate(options: JevActionGateOptions = {}): Type<ToolPolicy> {
  @Injectable()
  class ConfiguredJevActionGate extends JevActionGatePolicy {
    constructor(
      @Optional() @Inject(JEV_CLIENT) client?: JevClient,
      @Optional() @Inject(JEV_DEFAULTS) defaults?: JevDefaults,
    ) {
      super(options, client, defaults);
    }
  }
  Object.defineProperty(ConfiguredJevActionGate, 'name', { value: options.name ?? 'JevActionGate' });
  return ConfiguredJevActionGate;
}
