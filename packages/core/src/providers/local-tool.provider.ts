import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { APPROVAL_STORE, IDEMPOTENCY_STORE, POLICY_INSTANCES } from '../constants';
import {
  ApprovalToolNotFoundError,
  ExecutionCancelledError,
  ExecutionLimitExceededError,
  PolicyNotRegisteredError,
} from '../errors';
import { ToolDiscoveryService } from '../discovery/tool-discovery.service';
import type { DiscoveredTool } from '../discovery/tool-discovery.service';
import { auditEnvelope } from '../interfaces';
import type {
  AgentContext,
  ApprovalStore,
  IdempotencyStore,
  ResolvedTool,
  ToolExecutionResult,
  ToolParamSchema,
  ToolPolicy,
} from '../interfaces';
import { AuditTrail } from '../services/audit-trail.service';

type PolicyConstructor = new (...args: unknown[]) => ToolPolicy;

@Injectable()
export class LocalToolProvider {
  constructor(
    @Optional() @Inject(POLICY_INSTANCES) private readonly policyInstances: ToolPolicy[],
    @Inject(APPROVAL_STORE) private readonly approvalStore: ApprovalStore,
    private readonly discovery: ToolDiscoveryService,
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly audit?: AuditTrail,
    @Optional() @Inject(IDEMPOTENCY_STORE) private readonly idempotencyStore?: IdempotencyStore,
  ) {}

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

  /**
   * Namespaces a caller-supplied idempotency key by tenant before it reaches
   * the `IdempotencyStore`.
   *
   * Without this, `IdempotencyStore` lookups and saves are keyed on the raw
   * `idempotencyKey` string alone, so two tenants supplying the same literal
   * key (accidentally or deliberately) would read and cache each other's
   * `ToolExecutionResult`, including its `data` payload. `SessionStore`
   * already scopes by tenant this way (`AgentRunner.sessionKey()`); this
   * brings idempotency in line with it.
   */
  private scopedIdempotencyKey(agentContext: AgentContext, idempotencyKey: string): string {
    const tenantId = agentContext.security.tenantId ?? 'default';
    return `${tenantId}:${idempotencyKey}`;
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

      return discovered.tools.map((tool) =>
        this.buildResolvedTool(
          tool,
          discovered.classPolicyConstructors,
          agentContext,
          agentName,
          defaultApprovalTtlSeconds,
        ),
      );
    });
  }

  /**
   * Invokes a tool method directly, bypassing *pre-execution* policy evaluation.
   *
   * Used to resolve an already-approved `PendingApproval`: the policy that
   * required approval already ran once, and a human decision now stands in
   * for it. Any policies declared after it in the pre-execution chain were
   * never evaluated originally and are not evaluated here either, matching
   * prior behavior.
   *
   * Output Rails (`evaluateOutput`) are **not** skipped: an approved call is
   * often the most sensitive one a tool makes, and its result still passes
   * through the same `evaluateOutput` chain that a normal `allow`-decision
   * call would, so `SecretRedactionPolicy`/`CanaryDetectionPolicy`/custom
   * output rails still see and can sanitize or deny the result.
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

    const rawIdempotencyKey =
      (args?.idempotencyKey as string) || (agentContext.data?.idempotencyKey as string);
    const idempotencyKey = rawIdempotencyKey
      ? this.scopedIdempotencyKey(agentContext, rawIdempotencyKey)
      : undefined;
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
        return {
          tool: match,
          allPolicyConstructors: [...(discovered!.classPolicyConstructors ?? []), ...match.policyConstructors],
        };
      }
    }
    return undefined;
  }

  /**
   * Runs the post-execution Output Rail chain (`evaluateOutput`) against a
   * tool's execution result, applying `sanitize`/`deny`/`allow` decisions and
   * recording the corresponding audit events. Shared by the normal
   * policy-guarded closure and `invokeApprovedTool`, so an approved call's
   * result is never exempt from output sanitization.
   */
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
    classPolicyConstructors: PolicyConstructor[],
    agentContext: AgentContext,
    agentName: string,
    defaultApprovalTtlSeconds?: number,
  ): ResolvedTool {
    const allPolicyConstructors = [...classPolicyConstructors, ...tool.policyConstructors];

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

        const rawIdempotencyKey =
          (args?.idempotencyKey as string) || (agentContext.data?.idempotencyKey as string);
        const idempotencyKey = rawIdempotencyKey
          ? this.scopedIdempotencyKey(agentContext, rawIdempotencyKey)
          : undefined;
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
 * Safely evaluates if a deadline timestamp has expired, supporting both Date objects
 * and serialized ISO-8601 string representations.
 */
function isDeadlineExceeded(deadline?: Date | string | number): boolean {
  if (!deadline) return false;
  const time = deadline instanceof Date ? deadline.getTime() : new Date(deadline).getTime();
  return !isNaN(time) && Date.now() > time;
}
