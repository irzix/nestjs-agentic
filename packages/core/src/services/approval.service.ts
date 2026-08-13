import { Inject, Injectable } from '@nestjs/common';
import { APPROVAL_STORE } from '../constants';
import { ApprovalExpiredError, ApprovalNotFoundError } from '../errors';
import { auditEnvelope } from '../interfaces';
import type { ApprovalStore, AuditActor, PendingApproval } from '../interfaces';
import type { AgentResult } from '../interfaces';
import type { ToolExecutionResult } from '../interfaces';
import { AgentRunner } from './agent-runner.service';
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
  ) {}

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
    const claimed = await this.store.claim(approvalId);

    if (!claimed) {
      throw new ApprovalNotFoundError(approvalId);
    }

    const outcome = decision.approved ? 'approved' : 'rejected';

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
