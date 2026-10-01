import { Inject, Injectable, Optional } from '@nestjs/common';
import { AGENTIC_OPTIONS, APPROVAL_AUTHORIZER, APPROVAL_STORE } from '../constants';
import {
  ApprovalExpiredError,
  ApprovalNotAuthorizedError,
  ApprovalNotFoundError,
  ApprovalSignaturesUnsupportedError,
  ExecutionCancelledError,
} from '../errors';
import { auditEnvelope, requiredApprovalsOf } from '../interfaces';
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
   * **Dual control.** When the approval needs more than one approver
   * (`requiredApprovals` above 1), each call records one signature. Until the
   * threshold is met it returns a `pending_approval` result carrying
   * `signatures` and `requiredApprovals`, and the tool does not run. The call
   * that meets the threshold settles the approval as above. Every signature
   * goes through the authorizer, tenant isolation, and separation-of-duties
   * checks, must come from an identified `actor.userId`, and a repeated
   * signature from the same `userId` is refused with
   * `ApprovalNotAuthorizedError` rather than counted twice.
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
   * On a dual-control approval a single authorized rejection is a veto: it
   * settles the approval however many signatures it has collected.
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

    // Approving always reads first, because whether the approval needs more
    // than one signature is decided by the stored record.
    if (governed || decision.approved) {
      const pending = await this.store.get(approvalId);
      if (!pending) {
        throw new ApprovalNotFoundError(approvalId);
      }

      if (decision.approved && requiredApprovalsOf(pending) > 1) {
        return this.sign(pending, options);
      }

      if (governed) {
        const refusal = await this.checkAuthorization(pending, options?.actor);
        if (refusal) {
          await this.recordRefusal(pending, decision.approved ? 'approved' : 'rejected', refusal, options?.actor);
          throw new ApprovalNotAuthorizedError(approvalId, refusal);
        }
        authorizedFingerprint = fingerprint(pending);
      }
    }

    const claimed = await raceAbort(this.store.claim(approvalId), options?.signal);
    if (!claimed) {
      throw new ApprovalNotFoundError(approvalId);
    }

    return this.applyClaimed(claimed, decision, options, authorizedFingerprint, claimed);
  }

  /**
   * Records one approver's signature on a dual-control approval, and settles
   * it when that signature meets the threshold.
   */
  private async sign(
    pending: PendingApproval,
    options?: SettleApprovalOptions,
  ): Promise<AgentResult | ToolExecutionResult> {
    const approvalId = pending.id;
    const required = requiredApprovalsOf(pending);
    const actor = options?.actor;

    if (typeof this.store.addSignature !== 'function') {
      throw new ApprovalSignaturesUnsupportedError(approvalId);
    }

    // Signatures are told apart by userId, so an unidentified approver could
    // never be shown to be a distinct person.
    if (!actor?.userId) {
      const reason = 'dual control: every approver must be identified by actor.userId so signatures can be told apart';
      await this.recordRefusal(pending, 'approved', reason, actor);
      throw new ApprovalNotAuthorizedError(approvalId, reason);
    }

    const refusal = await this.checkAuthorization(pending, actor);
    if (refusal) {
      await this.recordRefusal(pending, 'approved', refusal, actor);
      throw new ApprovalNotAuthorizedError(approvalId, refusal);
    }

    // An expired approval is consumed and reported exactly as a single-approver
    // one is, rather than collecting signatures it can never use.
    if (isExpired(pending)) {
      const claimed = await raceAbort(this.store.claim(approvalId), options?.signal);
      if (!claimed) {
        throw new ApprovalNotFoundError(approvalId);
      }
      return this.applyClaimed(claimed, { approved: true }, options, undefined, claimed);
    }

    const userId = actor.userId;
    const result = await raceAbort(
      this.store.addSignature(approvalId, { actor: { ...actor, userId }, signedAt: new Date() }),
      options?.signal,
    );
    if (!result) {
      throw new ApprovalNotFoundError(approvalId);
    }

    if (result.status === 'duplicate') {
      const reason = `dual control: "${userId}" has already signed this approval and cannot be counted twice`;
      await this.recordRefusal(pending, 'approved', reason, actor);
      throw new ApprovalNotAuthorizedError(approvalId, reason);
    }

    const signatures = result.approval.signatures ?? [];
    // A store completing a record that already met its threshold (crash
    // recovery) did not append this caller's signature, so nothing was signed.
    if (signatures.some((signature) => signature.actor.userId === userId)) {
      await this.audit?.record({
        ...auditEnvelope(result.approval.context),
        type: 'approval_signed',
        approvalId,
        agentName: result.approval.agentName,
        toolName: result.approval.toolName,
        actor,
        signatures: signatures.length,
        requiredApprovals: required,
      });
    }

    if (result.status === 'pending') {
      return {
        success: false,
        status: 'pending_approval',
        reason: result.approval.reason,
        approvalId,
        signatures: signatures.length,
        requiredApprovals: required,
      };
    }

    // The final signature is the claim. If the record differs from the one
    // this signature was authorized against, restore it without this
    // signature, so the refused signer leaves no trace on the decision.
    const restore: PendingApproval = {
      ...result.approval,
      signatures: signatures.filter((signature) => signature.actor.userId !== userId),
    };
    return this.applyClaimed(result.approval, { approved: true }, options, fingerprint(pending), restore);
  }

  /**
   * Applies a decision to an approval the caller has already claimed, and
   * records the outcome. `restore` is what goes back into the store if the
   * claimed record turns out to differ from the authorized one.
   */
  private async applyClaimed(
    claimed: PendingApproval,
    decision: { approved: true } | { approved: false; reason?: string },
    options: SettleApprovalOptions | undefined,
    authorizedFingerprint: string | undefined,
    restore: PendingApproval,
  ): Promise<AgentResult | ToolExecutionResult> {
    const approvalId = claimed.id;
    const outcome = decision.approved ? 'approved' : 'rejected';

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
        await this.store.save(restore);
      } catch {
        restored = false;
      }

      await this.recordRefusal(
        claimed,
        outcome,
        restored ? reason : `${reason} (and could not be restored to the store)`,
        options?.actor,
      );

      throw new ApprovalNotAuthorizedError(approvalId, reason);
    }

    if (isExpired(claimed)) {
      const expiredAt = new Date(claimed.expiresAt!);

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
      ...(claimed.signatures?.length
        ? { signatures: claimed.signatures.map((signature) => signature.actor) }
        : {}),
      reason: decision.approved ? claimed.reason : decision.reason ?? claimed.reason,
      args: claimed.args,
    });

    return result;
  }

  private async recordRefusal(
    approval: PendingApproval,
    outcome: 'approved' | 'rejected',
    reason: string,
    actor?: AuditActor,
  ): Promise<void> {
    await this.audit?.record({
      ...auditEnvelope(approval.context),
      type: 'approval_settlement_denied',
      approvalId: approval.id,
      agentName: approval.agentName,
      toolName: approval.toolName,
      outcome,
      reason,
      actor,
    });
  }
}

function isExpired(approval: PendingApproval): boolean {
  return Boolean(approval.expiresAt) && Date.now() > new Date(approval.expiresAt!).getTime();
}

/** Settles `promise`, or rejects with `ExecutionCancelledError` once `signal` aborts. */
async function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;

  let abortHandler: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    abortHandler = () => reject(new ExecutionCancelledError());
    signal.addEventListener('abort', abortHandler, { once: true });
  });

  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (abortHandler) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

/**
 * Identifies the version of an approval that an authorization decision was made
 * about.
 *
 * Covers the whole record rather than the fields the built-in checks happen to
 * read, since a custom `ApprovalAuthorizer` may base its decision on any of them
 * — `reason`, `context.security.roles`, `expiresAt`. Dual-control signatures are
 * the exception: they are collected after authorization by design. Canonical serialization
 * makes the comparison independent of key order and of a store round-trip that
 * revives dates.
 */
function fingerprint(approval: PendingApproval): string {
  const { signatures: _signatures, ...decided } = approval;
  return canonicalize(decided);
}
