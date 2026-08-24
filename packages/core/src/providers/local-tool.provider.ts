import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { AGENTIC_OPTIONS, APPROVAL_STORE, IDEMPOTENCY_STORE, POLICY_INSTANCES } from '../constants';
import {
  ApprovalToolNotFoundError,
  ExecutionCancelledError,
  ExecutionLimitExceededError,
  PolicyNotRegisteredError,
} from '../errors';
import { ToolDiscoveryService } from '../discovery/tool-discovery.service';
import type { DiscoveredTool } from '../discovery/tool-discovery.service';
import { auditEnvelope } from '../interfaces';
import { scopeKey } from '../utils/scope-key';
import type {
  AgentContext,
  ApprovalStore,
  IdempotencyStore,
  ResolvedTool,
  ToolExecutionResult,
  ToolParamSchema,
  ToolPolicy,
} from '../interfaces';
import type { AgenticModuleOptions } from '../services/agent-runner.service';
import { AuditTrail } from '../services/audit-trail.service';

type PolicyConstructor = new (...args: unknown[]) => ToolPolicy;

@Injectable()
export class LocalToolProvider {
  /**
   * Tools that already triggered the no-replacement-policy warning, so it
   * logs once per tool rather than once per call. Keyed by instance + method
   * name (not `toolName` alone) — two different toolsets can expose a tool
   * with the same name, and toolName-only keying would let one suppress the
   * other's warning.
   */
  private readonly warnedExemptTools = new WeakMap<object, Set<string>>();

  constructor(
    @Optional() @Inject(POLICY_INSTANCES) private readonly policyInstances: ToolPolicy[],
    @Inject(APPROVAL_STORE) private readonly approvalStore: ApprovalStore,
    private readonly discovery: ToolDiscoveryService,
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly audit?: AuditTrail,
    @Optional() @Inject(IDEMPOTENCY_STORE) private readonly idempotencyStore?: IdempotencyStore,
    @Optional() @Inject(AGENTIC_OPTIONS) private readonly options?: AgenticModuleOptions,
  ) {}

  /**
   * Module-wide default policies, prepended to every tool's own policy chain
   * unless the tool is exempted via `@ExemptFromDefaultPolicies()`. Runs
   * first so a deny-by-default guard short-circuits before any tool-specific
   * policy is even evaluated.
   */
  private defaultPolicyConstructors(exempt: boolean): PolicyConstructor[] {
    if (exempt) return [];
    return this.options?.defaultPolicies ?? [];
  }

  /**
   * An exempt tool with no policies of its own (no class- or method-level
   * `@UsePolicies`) runs completely unguarded — that's a deliberate,
   * documented capability, not a bug, but silent is different from
   * deliberate. Warns once per tool so the gap is visible instead of only
   * discoverable by reading `DiscoveredTool.exemptFromDefaultPolicies`.
   */
  private warnIfExemptWithNoPolicies(tool: DiscoveredTool, allPolicyConstructors: PolicyConstructor[]): void {
    if (!tool.exemptFromDefaultPolicies || allPolicyConstructors.length > 0) return;

    let warnedMethods = this.warnedExemptTools.get(tool.instance);
    if (!warnedMethods) {
      warnedMethods = new Set();
      this.warnedExemptTools.set(tool.instance, warnedMethods);
    }
    if (warnedMethods.has(tool.methodName)) return;
    warnedMethods.add(tool.methodName);

    console.warn(
      `[LocalToolProvider] Tool "${tool.toolName}" is @ExemptFromDefaultPolicies() and has no @UsePolicies of its own — it runs with zero policy evaluation.`,
    );
  }

  private getPolicyMap(): Map<Function | string, ToolPolicy> {
    let instances = Array.isArray(this.policyInstances) ? this.policyInstances : [];
    if (instances.length === 0) {
      try {
        instances = this.moduleRef.get(POLICY_INSTANCES, { strict: false, each: true });
      } catch {
        instances = [];
      }
    }
    const list = Array.isArray(instances) ? instances : [instances];
    const map = new Map<Function | string, ToolPolicy>();
    for (const p of list) {
      if (p?.constructor) {
        map.set(p.constructor, p);
        map.set(p.constructor.name, p);
      }
    }
    return map;
  }

  private resolvePolicy(
    Constructor: PolicyConstructor,
    policyMap: Map<Function | string, ToolPolicy>,
  ): ToolPolicy | undefined {
    const existing = policyMap.get(Constructor) ?? policyMap.get(Constructor.name);
    if (existing) {
      return existing;
    }

    try {
      return this.moduleRef.get(Constructor, { strict: false });
    } catch {
      return undefined;
    }
  }

  /** Scopes an idempotency key by tenant using the shared collision-free `scopeKey`. */
  private scopedIdempotencyKey(agentContext: AgentContext, idempotencyKey: string): string {
    return scopeKey(agentContext.security.tenantId, idempotencyKey);
  }

  /** Resolves and tenant-scopes the caller-supplied idempotency key, if any. */
  private resolveIdempotencyKey(
    args: Record<string, unknown> | undefined,
    agentContext: AgentContext,
  ): string | undefined {
    const fromArgs = args?.idempotencyKey;
    const fromContext = agentContext.data?.idempotencyKey;
    const raw = typeof fromArgs === 'string' && fromArgs ? fromArgs : fromContext;

    if (typeof raw !== 'string' || !raw) {
      return undefined;
    }

    return this.scopedIdempotencyKey(agentContext, raw);
  }

  /**
   * Builds policy-guarded tool closures for one agent turn.
   * `agentName` is stored on any `PendingApproval` created while executing
   * these tools, so a later resume can re-resolve the same agent's tool set
   * through DI instead of closing over live instances.
   */
  buildTools(
    toolSetTokensOrInstances: (object | Function)[],
    agentContext: AgentContext,
    agentName = '',
    defaultApprovalTtlSeconds?: number,
  ): ResolvedTool[] {
    return toolSetTokensOrInstances.flatMap((tokenOrInstance) => {
      const instance = this.resolveInstance(tokenOrInstance);
      if (!instance) return [];

      const discovered = this.discovery.discover(instance);
      if (!discovered) return [];

      return discovered.tools.map((tool) => {
        const upstreamPolicyConstructors = [
          ...this.defaultPolicyConstructors(tool.exemptFromDefaultPolicies),
          ...discovered.classPolicyConstructors,
        ];
        this.warnIfExemptWithNoPolicies(tool, [...upstreamPolicyConstructors, ...tool.policyConstructors]);
        return this.buildResolvedTool(
          tool,
          upstreamPolicyConstructors,
          agentContext,
          agentName,
          defaultApprovalTtlSeconds,
        );
      });
    });
  }

  /**
   * Invokes an already-approved tool, skipping pre-execution policy checks
   * (already satisfied by the approval) but still running Output Rails.
   */
  async invokeApprovedTool(
    toolSetTokensOrInstances: (object | Function)[],
    toolName: string,
    args: Record<string, unknown>,
    agentContext: AgentContext,
    agentName = '',
  ): Promise<ToolExecutionResult> {
    if (agentContext.signal?.aborted) {
      throw new ExecutionCancelledError();
    }

    if (isDeadlineExceeded(agentContext.deadline)) {
      throw new ExecutionLimitExceededError('timeout', 0);
    }

    const discovered = this.discoverToolByName(toolSetTokensOrInstances, toolName);
    if (!discovered) {
      throw new ApprovalToolNotFoundError(toolName);
    }
    const { tool, allPolicyConstructors } = discovered;

    const idempotencyKey = this.resolveIdempotencyKey(args, agentContext);
    if (idempotencyKey && this.idempotencyStore) {
      const cached = await this.idempotencyStore.get(idempotencyKey);
      if (cached) return cached.result;
    }

    const executionResult = await this.invokeMethod(tool, args, agentContext);

    const finalResult = await this.runOutputRails(
      executionResult,
      allPolicyConstructors,
      agentContext,
      agentName,
      tool.toolName,
      args,
    );

    if (idempotencyKey && this.idempotencyStore && finalResult.success) {
      await this.idempotencyStore.save({
        key: idempotencyKey,
        toolName,
        result: finalResult,
        createdAt: new Date(),
      });
    }

    return finalResult;
  }

  private discoverToolByName(
    toolSetTokensOrInstances: (object | Function)[],
    toolName: string,
  ): { tool: DiscoveredTool; allPolicyConstructors: PolicyConstructor[] } | undefined {
    for (const tokenOrInstance of toolSetTokensOrInstances) {
      const instance = this.resolveInstance(tokenOrInstance);
      if (!instance) continue;

      const discovered = this.discovery.discover(instance);
      const match = discovered?.tools.find((t) => t.toolName === toolName);
      if (match) {
        const allPolicyConstructors = [
          ...this.defaultPolicyConstructors(match.exemptFromDefaultPolicies),
          ...(discovered!.classPolicyConstructors ?? []),
          ...match.policyConstructors,
        ];
        this.warnIfExemptWithNoPolicies(match, allPolicyConstructors);
        return { tool: match, allPolicyConstructors };
      }
    }
    return undefined;
  }

  /** Runs `evaluateOutput` for each policy, applying sanitize/deny and recording audit events. */
  private async runOutputRails(
    executionResult: ToolExecutionResult,
    allPolicyConstructors: PolicyConstructor[],
    agentContext: AgentContext,
    agentName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    let finalResult = executionResult;
    if (!finalResult.success) {
      return finalResult;
    }

    const policyMap = this.getPolicyMap();

    for (const Constructor of allPolicyConstructors) {
      const policy = this.resolvePolicy(Constructor, policyMap);
      if (!policy?.evaluateOutput) continue;

      const outputResult = await policy.evaluateOutput(agentContext, toolName, finalResult.data);

      if (outputResult.decision === 'deny') {
        await this.audit?.record({
          ...auditEnvelope(agentContext),
          type: 'tool_output_policy_decision',
          agentName,
          toolName,
          policyName: Constructor.name,
          decision: 'deny',
          reason: outputResult.reason,
          args,
        });

        return { success: false, status: 'denied', reason: outputResult.reason };
      }

      if (outputResult.decision === 'sanitize') {
        finalResult = { ...finalResult, data: outputResult.sanitizedResult };

        await this.audit?.record({
          ...auditEnvelope(agentContext),
          type: 'tool_output_policy_decision',
          agentName,
          toolName,
          policyName: Constructor.name,
          decision: 'sanitize',
          reason: 'Output sanitized by policy',
          args,
        });
      } else if (outputResult.decision === 'allow') {
        await this.audit?.record({
          ...auditEnvelope(agentContext),
          type: 'tool_output_policy_decision',
          agentName,
          toolName,
          policyName: Constructor.name,
          decision: 'allow',
          args,
        });
      }
    }

    return finalResult;
  }

  /**
   * Runs Output Rail policies against a tool's error message, so a thrown
   * exception (a connection string, an upstream response body, a stack
   * trace fragment folded into `Error.message`) gets the same
   * `SecretRedactionPolicy`/`CanaryDetectionPolicy` treatment as a
   * successful result's `data`. Reuses `evaluateOutput` against a
   * `{ error: rawMessage }` wrapper rather than the bare string, since
   * policies are written to sanitize an arbitrary output value, not
   * specifically a string.
   *
   * A `deny` decision here doesn't withhold the tool call the way it would
   * for a successful result — the call already happened and already failed.
   * It instead replaces the message with the policy's `reason`, so the
   * original (potentially sensitive) error text is not reported to the model
   * even when a policy chooses to fully block it rather than sanitize it.
   */
  private async sanitizeErrorMessage(
    rawMessage: string,
    allPolicyConstructors: PolicyConstructor[],
    agentContext: AgentContext,
    agentName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const policyMap = this.getPolicyMap();
    let message = rawMessage;

    for (const Constructor of allPolicyConstructors) {
      const policy = this.resolvePolicy(Constructor, policyMap);
      if (!policy?.evaluateOutput) continue;

      const outputResult = await policy.evaluateOutput(agentContext, toolName, { error: message });

      if (outputResult.decision === 'deny') {
        await this.audit?.record({
          ...auditEnvelope(agentContext),
          type: 'tool_output_policy_decision',
          agentName,
          toolName,
          policyName: Constructor.name,
          decision: 'deny',
          reason: outputResult.reason,
          args,
        });
        message = outputResult.reason;
        continue;
      }

      if (outputResult.decision === 'sanitize') {
        const sanitized = outputResult.sanitizedResult;
        message = isErrorWrapper(sanitized) ? String(sanitized.error) : String(sanitized);

        await this.audit?.record({
          ...auditEnvelope(agentContext),
          type: 'tool_output_policy_decision',
          agentName,
          toolName,
          policyName: Constructor.name,
          decision: 'sanitize',
          reason: 'Tool error message sanitized by policy',
          args,
        });
      }
    }

    return message;
  }

  private resolveInstance(tokenOrInstance: object | Function): object | undefined {
    if (typeof tokenOrInstance !== 'function') {
      return tokenOrInstance;
    }

    let instance: object | undefined;
    const Constructor = tokenOrInstance as new (...args: unknown[]) => object;
    try {
      instance = this.moduleRef.get(Constructor, { strict: false });
    } catch {
      instance = undefined;
    }
    if (!instance) {
      try {
        instance = new Constructor();
      } catch {
        instance = undefined;
      }
    }
    return instance;
  }

  private buildResolvedTool(
    tool: DiscoveredTool,
    /** Module defaults (unless exempted) followed by class-level `@UsePolicies`. */
    upstreamPolicyConstructors: PolicyConstructor[],
    agentContext: AgentContext,
    agentName: string,
    defaultApprovalTtlSeconds?: number,
  ): ResolvedTool {
    const allPolicyConstructors = [...upstreamPolicyConstructors, ...tool.policyConstructors];

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
      sanitizeErrorMessage: (rawMessage, args) =>
        this.sanitizeErrorMessage(rawMessage, allPolicyConstructors, agentContext, agentName, tool.toolName, args),
      execute: async ({
        args,
        toolCallId,
      }: {
        args: Record<string, unknown>;
        toolCallId?: string;
      }): Promise<ToolExecutionResult> => {
        if (agentContext.signal?.aborted) {
          throw new ExecutionCancelledError();
        }

        if (isDeadlineExceeded(agentContext.deadline)) {
          throw new ExecutionLimitExceededError('timeout', 0);
        }

        const idempotencyKey = this.resolveIdempotencyKey(args, agentContext);
        if (idempotencyKey && this.idempotencyStore) {
          const cached = await this.idempotencyStore.get(idempotencyKey);
          if (cached) return cached.result;
        }

        const policyMap = this.getPolicyMap();

        for (const Constructor of allPolicyConstructors) {
          const policy = this.resolvePolicy(Constructor, policyMap);

          if (!policy) {
            throw new PolicyNotRegisteredError(Constructor.name);
          }

          const result = await policy.evaluate(agentContext, tool.toolName, args);

          if (result.decision === 'deny') {
            await this.audit?.record({
              ...auditEnvelope(agentContext),
              type: 'tool_policy_decision',
              agentName,
              toolName: tool.toolName,
              policyName: Constructor.name,
              decision: 'deny',
              reason: result.reason,
              args,
            });

            return { success: false, status: 'denied', reason: result.reason };
          }

          if (result.decision === 'require_approval') {
            const approvalId = randomUUID();
            const createdAt = new Date();
            // A policy's own ttlSeconds overrides the module default; when
            // neither is set the approval never expires.
            const ttlSeconds = result.ttlSeconds ?? defaultApprovalTtlSeconds;
            const expiresAt =
              ttlSeconds !== undefined
                ? new Date(createdAt.getTime() + ttlSeconds * 1000)
                : undefined;
            await this.approvalStore.save({
              id: approvalId,
              agentName,
              toolName: tool.toolName,
              args,
              context: agentContext,
              reason: result.reason,
              createdAt,
              expiresAt,
              toolCallId,
            });

            if (this.audit?.isEnabled()) {
              const envelope = auditEnvelope(agentContext);

              // Both the boundary decision and the resulting request are
              // recorded: the first proves the call was gated, the second is
              // what a reviewer correlates their eventual decision against.
              await this.audit.record({
                ...envelope,
                type: 'tool_policy_decision',
                agentName,
                toolName: tool.toolName,
                policyName: Constructor.name,
                decision: 'require_approval',
                reason: result.reason,
                approvalId,
                args,
              });
              await this.audit.record({
                ...envelope,
                type: 'approval_requested',
                approvalId,
                agentName,
                toolName: tool.toolName,
                reason: result.reason,
                expiresAt,
                args,
              });
            }

            return {
              success: false,
              status: 'pending_approval',
              reason: result.reason,
              approvalId,
            };
          }

          await this.audit?.record({
            ...auditEnvelope(agentContext),
            type: 'tool_policy_decision',
            agentName,
            toolName: tool.toolName,
            policyName: Constructor.name,
            decision: 'allow',
            args,
          });
        }

        const executionResult = await this.invokeMethod(tool, args, agentContext);
        const finalResult = await this.runOutputRails(
          executionResult,
          allPolicyConstructors,
          agentContext,
          agentName,
          tool.toolName,
          args,
        );

        if (idempotencyKey && this.idempotencyStore && finalResult.success) {
          await this.idempotencyStore.save({
            key: idempotencyKey,
            toolName: tool.toolName,
            result: finalResult,
            createdAt: new Date(),
          });
        }

        return finalResult;
      },
    };
  }

  private async invokeMethod(
    tool: DiscoveredTool,
    args: Record<string, unknown>,
    agentContext: AgentContext,
  ): Promise<ToolExecutionResult> {
    const methodArgs: unknown[] = [];

    for (const param of tool.params) {
      methodArgs[param.index] = args[param.name];
    }

    if (tool.contextParamIndex !== undefined) {
      methodArgs[tool.contextParamIndex] = agentContext;
    }

    const data = await (
      tool.instance as Record<string, (...args: unknown[]) => Promise<unknown>>
    )[tool.methodName](...methodArgs);

    return { success: true, data };
  }
}

/**
 * Narrows a policy's `sanitizedResult` to the `{ error: unknown }` shape
 * `sanitizeErrorMessage` wraps error messages in, without an unchecked type
 * assertion.
 */
function isErrorWrapper(value: unknown): value is { error: unknown } {
  return typeof value === 'object' && value !== null && 'error' in value;
}

/**
 * Safely evaluates if a deadline timestamp has expired, supporting both Date objects
 * and serialized ISO-8601 string representations.
 */
function isDeadlineExceeded(deadline?: Date | string | number): boolean {
  if (!deadline) return false;
  const time = deadline instanceof Date ? deadline.getTime() : new Date(deadline).getTime();
  return !isNaN(time) && Date.now() > time;
}
