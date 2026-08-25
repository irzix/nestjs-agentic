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
   * Runs the separation-of-duties check and any registered `ApprovalAuthorizer`.
   *
   * @returns A refusal reason, or `undefined` when the settlement may proceed.
   */
  private async checkAuthorization(
    approval: PendingApproval,
    actor?: AuditActor,
  ): Promise<string | undefined> {
    if (this.governanceOptions().enforceSeparationOfDuties) {
      // Only a proven conflict refuses: both identities must be known and equal.
      // An unknown identity on either side cannot be shown to be the same person,
      // so it is not treated as a violation (an ApprovalAuthorizer is the right
      // place to reject unidentified settlements outright).
      const requesterId = approval.requestedBy?.userId ?? approval.context.security.userId;
      const approverId = actor?.userId;

      if (requesterId !== undefined && approverId !== undefined && requesterId === approverId) {
        return `separation of duties: "${approverId}" requested this action and cannot also approve it`;
      }
    }

    if (!this.authorizer) {
      return undefined;
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

    // Authorization runs against a non-destructive read, before the claim.
    // Claiming first would consume the approval on a refused attempt, letting an
    // unauthorized caller destroy a pending decision. The read/claim race this
    // introduces is harmless: `claim()` remains the exactly-once primitive, so a
    // concurrent settlement still results in exactly one execution.
    if (this.authorizer || this.governanceOptions().enforceSeparationOfDuties) {
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
