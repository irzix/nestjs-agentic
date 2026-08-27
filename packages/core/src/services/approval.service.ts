import { Inject, Injectable, Optional } from '@nestjs/common';
import { AGENTIC_OPTIONS, APPROVAL_AUTHORIZER, APPROVAL_STORE } from '../constants';
import {
  ApprovalExpiredError,
  ApprovalNotAuthorizedError,
  ApprovalNotFoundError,
  ExecutionCancelledError,
} from '../errors';
import { auditEnvelope } from '../interfaces';
import type {
  ApprovalAuthorizer,
  ApprovalGovernanceOptions,
  ApprovalStore,
  AuditActor,
  PendingApproval,
} from '../interfaces';
import type { AgentResult } from '../interfaces';
import type { ToolExecutionResult } from '../interfaces';
import { canonicalize } from '../audit/hash-chain-audit.sink';
import { AgentRunner, type AgenticModuleOptions } from './agent-runner.service';
import { AuditTrail } from './audit-trail.service';

/** Who is resolving the approval, recorded on the audit trail. */
export interface SettleApprovalOptions {
  /**
   * Identity of the human or system making the decision.
   *
   * Optional to stay compatible, but omitting it means the audit trail records
   * that an approval was settled without recording who settled it, which most
   * review processes will not accept.
   */
  actor?: AuditActor;
  signal?: AbortSignal;
}

@Injectable()
export class ApprovalService {
  constructor(
    @Inject(APPROVAL_STORE) private readonly store: ApprovalStore,
    private readonly runner: AgentRunner,
    private readonly audit?: AuditTrail,
    @Optional() @Inject(APPROVAL_AUTHORIZER) private readonly authorizer?: ApprovalAuthorizer,
    @Optional() @Inject(AGENTIC_OPTIONS) private readonly options?: AgenticModuleOptions,
  ) {}

  private governanceOptions(): ApprovalGovernanceOptions {
    return this.options?.approvals ?? {};
  }

  /**
   * Runs tenant isolation, separation of duties, and any registered authorizer.
   *
   * @returns A refusal reason, or `undefined` when the settlement may proceed.
   */
  private async checkAuthorization(
    approval: PendingApproval,
    actor?: AuditActor,
  ): Promise<string | undefined> {
    const governance = this.governanceOptions();
    const approvalTenant = approval.context.security.tenantId;

    // Both checks fail closed on an unknown tenant: an unproven match is not
    // treated as permission, and an unproven difference is not treated as
    // separation.
    if (governance.enforceTenantIsolation) {
      if (approvalTenant === undefined) {
        return 'tenant isolation: approval carries no tenant, so the approver cannot be shown to belong to it';
      }
      if (actor?.tenantId === undefined) {
        return `tenant isolation: approval belongs to tenant "${approvalTenant}" and the approver supplied no tenant`;
      }
      if (actor.tenantId !== approvalTenant) {
        return `tenant isolation: approval belongs to tenant "${approvalTenant}", not "${actor.tenantId}"`;
      }
    }

    if (governance.enforceSeparationOfDuties) {
      const requester = approval.requestedBy ?? approval.context.security;
      const requesterTenant = requester.tenantId ?? approvalTenant;
      // Only a *proven* difference clears the conflict, so an unknown tenant on
      // either side still counts as the same person.
      const differentTenant =
        requesterTenant !== undefined &&
        actor?.tenantId !== undefined &&
        requesterTenant !== actor.tenantId;
      const conflict =
        requester.userId !== undefined &&
        actor?.userId !== undefined &&
        requester.userId === actor.userId &&
        !differentTenant;

      if (conflict) {
        return `separation of duties: "${actor?.userId}" requested this action and cannot also approve it`;
      }
    }

    if (!this.authorizer) {
      // Strict mode lets a deployment fail closed rather than allow any caller
      // holding an approval ID to settle it.
      return governance.requireAuthorizer
        ? 'no ApprovalAuthorizer is registered and approvals.requireAuthorizer is enabled'
        : undefined;
    }

    const verdict = await this.authorizer.canSettle(approval, actor);

    if (verdict === true) return undefined;
    if (verdict === false) return 'refused by the registered ApprovalAuthorizer';
    if (verdict.allowed) return undefined;

    return verdict.reason ?? 'refused by the registered ApprovalAuthorizer';
  }

  /**
   * Executes the tool a pending approval withheld and removes it from the
   * store. When the approval suspended the built-in runtime's model loop,
   * the turn resumes and the model reacts to the outcome, so the return value
   * is the full `AgentResult` rather than the bare tool result. Approvals
   * created outside the built-in runtime (no `toolCallId`) still return the
   * `ToolExecutionResult` directly, matching prior behavior.
   *
   * The approval is claimed atomically before its tool runs, so a given
   * approval is settled at most once even under concurrent calls or a
   * restart-triggered retry. If the tool itself fails after the claim, the
   * approval is already consumed and will not be retried; making the
   * underlying side effect idempotent is the tool's responsibility.
   *
   * Pass `actor` to record who approved on the audit trail.
   *
   * Throws `ApprovalNotFoundError` if the ID is unknown, already resolved, or
   * claimed by a concurrent caller, and `ApprovalExpiredError` if it was
   * claimed after its `expiresAt`.
   */
  async approve(
    approvalId: string,
    options?: SettleApprovalOptions,
  ): Promise<AgentResult | ToolExecutionResult> {
    return this.settle(approvalId, { approved: true }, options);
  }

  /**
   * Rejects a pending approval and removes it from the store. When the
   * approval suspended the built-in runtime's model loop, the turn resumes
   * with a `denied` outcome so the model can recover within the same
   * conversation instead of the turn simply disappearing.
   *
   * The approval is claimed atomically, so a given approval is settled at most
   * once even under concurrent calls.
   *
   * Pass `actor` to record who rejected on the audit trail.
   *
   * Throws `ApprovalNotFoundError` if the ID is unknown, already resolved, or
   * claimed by a concurrent caller, and `ApprovalExpiredError` if it was
   * claimed after its `expiresAt`.
   */
  async reject(
    approvalId: string,
    options?: SettleApprovalOptions & { reason?: string },
  ): Promise<AgentResult | ToolExecutionResult> {
    return this.settle(
      approvalId,
      { approved: false, reason: options?.reason },
      options,
    );
  }

  /**
   * Claims the approval, applies the decision, and records the outcome.
   *
   * Shared by both paths so the audit trail cannot diverge between approving
   * and rejecting: every terminal state — settled, expired, or failed after the
   * claim — is recorded in exactly one place.
   */
  private async settle(
    approvalId: string,
    decision: { approved: true } | { approved: false; reason?: string },
    options?: SettleApprovalOptions,
  ): Promise<AgentResult | ToolExecutionResult> {
    if (options?.signal?.aborted) {
      throw new ExecutionCancelledError();
    }

    const outcome = decision.approved ? 'approved' : 'rejected';

    // Checked against a non-destructive read, before the claim: claiming first
    // would let a refused attempt consume the approval. The read/claim race is
    // harmless since `claim()` still enforces exactly-once settlement.
    const governance = this.governanceOptions();
    const governed =
      Boolean(this.authorizer) ||
      Boolean(governance.enforceSeparationOfDuties) ||
      Boolean(governance.enforceTenantIsolation) ||
      Boolean(governance.requireAuthorizer);

    let authorizedFingerprint: string | undefined;

    if (governed) {
      const pending = await this.store.get(approvalId);
      if (!pending) {
        throw new ApprovalNotFoundError(approvalId);
      }

      const refusal = await this.checkAuthorization(pending, options?.actor);
      if (refusal) {
        await this.audit?.record({
          ...auditEnvelope(pending.context),
          type: 'approval_settlement_denied',
          approvalId,
          agentName: pending.agentName,
          toolName: pending.toolName,
          outcome,
          reason: refusal,
          actor: options?.actor,
        });

        throw new ApprovalNotAuthorizedError(approvalId, refusal);
      }

      authorizedFingerprint = fingerprint(pending);
    }

    let abortHandler: (() => void) | undefined;
    let claimed: PendingApproval | null;

    if (options?.signal) {
      const abortPromise = new Promise<never>((_, reject) => {
        abortHandler = () => reject(new ExecutionCancelledError());
        options.signal!.addEventListener('abort', abortHandler, { once: true });
      });

      try {
        claimed = await Promise.race([this.store.claim(approvalId), abortPromise]);
      } finally {
        if (abortHandler) {
          options.signal.removeEventListener('abort', abortHandler);
        }
      }
    } else {
      claimed = await this.store.claim(approvalId);
    }

    if (!claimed) {
      throw new ApprovalNotFoundError(approvalId);
    }

    // Closes the read/claim window: a store whose `save()` replaced the record
    // between the authorization read and the claim would otherwise have its new
    // version settled against a decision made about the old one.
    if (authorizedFingerprint !== undefined && fingerprint(claimed) !== authorizedFingerprint) {
      const reason =
        'the approval changed between authorization and claim, so the decision no longer applies to it';

      // The claim already removed it, so restore the version that was actually
      // stored: a refused settlement must never destroy a pending decision.
      // Restoration is best-effort — if it fails, the refusal still stands, and
      // the audit event below is the record that the approval was lost.
      let restored = true;
      try {
        await this.store.save(claimed);
      } catch {
        restored = false;
      }

      await this.audit?.record({
        ...auditEnvelope(claimed.context),
        type: 'approval_settlement_denied',
        approvalId,
        agentName: claimed.agentName,
        toolName: claimed.toolName,
        outcome,
        reason: restored ? reason : `${reason} (and could not be restored to the store)`,
        actor: options?.actor,
      });

      throw new ApprovalNotAuthorizedError(approvalId, reason);
    }

    if (claimed.expiresAt && Date.now() > new Date(claimed.expiresAt).getTime()) {
      const expiredAt = new Date(claimed.expiresAt);

      await this.audit?.record({
        ...auditEnvelope(claimed.context),
        type: 'approval_expired',
        approvalId,
        agentName: claimed.agentName,
        toolName: claimed.toolName,
        expiredAt,
        actor: options?.actor,
      });

      throw new ApprovalExpiredError(approvalId, expiredAt);
    }

    let result: AgentResult | ToolExecutionResult;
    try {
      result = await this.runner.settleApproval(claimed, decision, options);
    } catch (err) {
      // The claim already consumed the approval, so this cannot be retried and
      // the tool may have applied part of its side effect. Worth alerting on.
      await this.audit?.record({
        ...auditEnvelope(claimed.context),
        type: 'approval_settlement_failed',
        approvalId,
        agentName: claimed.agentName,
        toolName: claimed.toolName,
        outcome,
        error: err instanceof Error ? err.message : String(err),
        actor: options?.actor,
      });

      throw err;
    }

    await this.audit?.record({
      ...auditEnvelope(claimed.context),
      type: 'approval_settled',
      approvalId,
      agentName: claimed.agentName,
      toolName: claimed.toolName,
      outcome,
      actor: options?.actor,
      reason: decision.approved ? claimed.reason : decision.reason ?? claimed.reason,
      args: claimed.args,
    });

    return result;
  }
}

/**
 * Identifies the version of an approval that an authorization decision was made
 * about.
 *
 * Covers the whole record rather than the fields the built-in checks happen to
 * read, since a custom `ApprovalAuthorizer` may base its decision on any of them
 * — `reason`, `context.security.roles`, `expiresAt`. Canonical serialization
 * makes the comparison independent of key order and of a store round-trip that
 * revives dates.
 */
function fingerprint(approval: PendingApproval): string {
  return canonicalize(approval);
}
