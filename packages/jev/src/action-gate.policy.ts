import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import type { AgentContext, PolicyResult, ToolPolicy } from '@nestjs-agentic/core';
import { askJev, formatAgainst, formatThreshold } from './ask-jev';
import {
  assertDualControlSupported,
  gateName,
  resolveJevCall,
  throwIfCancelled,
  type ResolvedJevCall,
} from './gate-support';
import type { JevCallOptions, JevClient, JevState } from './jev.interface';
import { JEV_CLIENT, JEV_DEFAULTS, type JevDefaults } from './jev.module';

/** What a gate does when Jev cannot answer. */
export type JevActionGateFallback = 'require_approval' | 'deny' | 'allow';

export interface JevActionGateOptions extends JevCallOptions {
  /**
   * Policy name recorded on the audit trail. Give each gate a distinct name:
   * core also resolves policy classes by name. Default: `'JevActionGate'`,
   * numbered (`'JevActionGate#2'`, ...) for every further unnamed gate.
   */
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
   * `allowAt`. A positive integer, or a function of the probability so
   * riskier calls can need more people (dual control). Anything else is
   * passed on for core to refuse the call. A call Jev could not judge needs
   * the most approvers this asks for anywhere in the band. Needs
   * `@nestjs-agentic/core` 1.6.0 or later when above 1. Default: `1`
   */
  requiredApprovals?: number | ((probability: number) => number);
  /** Lifetime of the resulting approval, in seconds. Defaults to the module's `approvalTtlSeconds`. */
  approvalTtlSeconds?: number;
  /**
   * Builds what Jev sees. Defaults to `{ tool, arguments }`. Whatever this
   * returns is sent to the TypeSafe API, so leave out what must not leave
   * your system and add what the judgment needs (the user's role, a spending
   * limit, the conversation goal).
   *
   * If it throws, the error propagates and the call does not run: a bug in
   * your own code is not a Jev outage, so `onError` does not apply.
   */
  describe?(ctx: AgentContext, toolName: string, args: Record<string, unknown>): JevState | Promise<JevState>;
  /**
   * Decision when Jev is unreachable, times out, fails fast on an open
   * circuit, or answers in an unexpected shape. Default: `'require_approval'`,
   * so an outage sends calls to a human rather than letting them through or
   * blocking them outright. A cancelled run is not an outage: the gate throws
   * `ExecutionCancelledError` instead.
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
 * audit trail shows why a call ran, was escalated, or was refused. (Allowed
 * calls are recorded only with `audit.includeAllowDecisions`.)
 *
 * Usually created with `JevActionGate(options)`, which returns an injectable
 * class to register through `AgenticModule.forFeature({ policies })`.
 */
export class JevActionGatePolicy implements ToolPolicy {
  private readonly call: ResolvedJevCall;
  private readonly name: string;
  private readonly allowAt: number;
  private readonly denyBelow: number;
  private readonly tools?: Set<string>;

  constructor(
    private readonly options: JevActionGateOptions,
    client?: JevClient,
    defaults: JevDefaults = {},
  ) {
    this.name = options.name ?? 'JevActionGate';
    this.call = resolveJevCall(this.name, options, client, defaults);
    this.allowAt = options.allowAt ?? 0.9;
    this.denyBelow = options.denyBelow ?? 0.1;
    if (!(this.denyBelow >= 0 && this.denyBelow <= this.allowAt && this.allowAt <= 1)) {
      throw new RangeError(
        `Jev gate thresholds must satisfy 0 <= denyBelow <= allowAt <= 1, received denyBelow ${this.denyBelow} and allowAt ${this.allowAt}.`,
      );
    }
    if (options.requiredApprovals !== undefined && options.requiredApprovals !== 1) {
      assertDualControlSupported(this.name);
    }
    this.tools = options.tools ? new Set(options.tools) : undefined;
  }

  async evaluate(ctx: AgentContext, toolName: string, args: Record<string, unknown>): Promise<PolicyResult> {
    if (this.tools && !this.tools.has(toolName)) {
      return { decision: 'allow' };
    }
    throwIfCancelled(ctx);

    // Outside the try: an error in the caller's own describe() is not a Jev outage.
    const state = this.options.describe
      ? await this.options.describe(ctx, toolName, args)
      : { tool: toolName, arguments: args };

    let probability: number;
    try {
      const { answers } = await askJev(
        this.call.client,
        state,
        {
          safe: {
            type: 'noul',
            instructions: this.options.question ?? DEFAULT_QUESTION,
            criteria: this.options.criteria ?? DEFAULT_CRITERIA,
          },
        },
        {
          model: this.call.model,
          timeoutMs: this.call.timeoutMs,
          circuitBreaker: this.call.circuitBreaker,
          signal: ctx.signal,
        },
      );
      probability = answers.safe.noul;
    } catch (err: unknown) {
      throwIfCancelled(ctx);
      return this.fallback(err instanceof Error ? err.message : String(err));
    }

    const p = formatAgainst(probability, [this.allowAt, this.denyBelow]);
    const bounds = `runs unreviewed at >= ${formatThreshold(this.allowAt)}, refused below ${formatThreshold(this.denyBelow)}`;

    if (probability >= this.allowAt) {
      return { decision: 'allow', reason: `Jev judged "${toolName}" safe to run (p(safe)=${p}; ${bounds}).` };
    }
    if (probability < this.denyBelow) {
      return { decision: 'deny', reason: `Jev judged "${toolName}" unsafe (p(safe)=${p}; ${bounds}).` };
    }

    return this.review(
      `Jev sent "${toolName}" to human review (p(safe)=${p}; ${bounds}).`,
      this.requiredApprovalsAt(probability),
    );
  }

  /** A `require_approval` result. Any count but 1 goes to core, which refuses invalid ones. */
  private review(reason: string, required: number): PolicyResult {
    return {
      decision: 'require_approval',
      reason,
      ...(required !== 1 ? { requiredApprovals: required } : {}),
      ...(this.options.approvalTtlSeconds !== undefined ? { ttlSeconds: this.options.approvalTtlSeconds } : {}),
    };
  }

  private requiredApprovalsAt(probability: number): number {
    const setting = this.options.requiredApprovals ?? 1;
    return typeof setting === 'function' ? setting(probability) : setting;
  }

  /**
   * The most approvers asked for anywhere in the review band: an unjudged
   * call is treated like the riskiest call Jev could have sent to review.
   */
  private strictestRequiredApprovals(): number {
    const setting = this.options.requiredApprovals ?? 1;
    if (typeof setting !== 'function') return setting;
    const steps = this.allowAt > this.denyBelow ? 100 : 1;
    let strictest = 1;
    for (let i = 0; i < steps; i++) {
      const required = setting(this.denyBelow + ((this.allowAt - this.denyBelow) * i) / steps);
      // An invalid count wins, so core refuses the call rather than trusting a smaller one.
      if (!(Number.isInteger(required) && required >= 1)) return required;
      if (required > strictest) strictest = required;
    }
    return strictest;
  }

  private fallback(error: string): PolicyResult {
    const mode = this.options.onError ?? 'require_approval';
    if (mode === 'allow') {
      return { decision: 'allow', reason: `Jev could not judge this call (${error}), so it was allowed by onError.` };
    }
    const reason = `Jev could not judge this call (${error}), so it was ${mode === 'deny' ? 'refused' : 'sent to human review'}.`;
    return mode === 'deny' ? { decision: 'deny', reason } : this.review(reason, this.strictestRequiredApprovals());
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
  const named = { ...options, name: gateName('JevActionGate', options.name) };

  @Injectable()
  class ConfiguredJevActionGate extends JevActionGatePolicy {
    constructor(
      @Optional() @Inject(JEV_CLIENT) client?: JevClient,
      @Optional() @Inject(JEV_DEFAULTS) defaults?: JevDefaults,
    ) {
      super(named, client, defaults);
    }
  }
  Object.defineProperty(ConfiguredJevActionGate, 'name', { value: named.name });
  return ConfiguredJevActionGate;
}
