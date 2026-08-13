import { Inject, Injectable } from '@nestjs/common';
import { APPROVAL_STORE } from '../constants';
import { ApprovalNotFoundError } from '../errors';
import type { ApprovalStore } from '../interfaces';
import type { AgentResult } from '../interfaces';
import type { ToolExecutionResult } from '../interfaces';
import { AgentRunner } from './agent-runner.service';

@Injectable()
export class ApprovalService {
  constructor(
    @Inject(APPROVAL_STORE) private readonly store: ApprovalStore,
    private readonly runner: AgentRunner,
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
   * Throws `ApprovalNotFoundError` if the ID is unknown, already resolved, or
   * claimed by a concurrent caller.
   */
  async approve(
    approvalId: string,
    options?: { signal?: AbortSignal },
  ): Promise<AgentResult | ToolExecutionResult> {
    const pending = await this.store.claim(approvalId);

    if (!pending) {
      throw new ApprovalNotFoundError(approvalId);
    }

    return this.runner.settleApproval(pending, { approved: true }, options);
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
   * Throws `ApprovalNotFoundError` if the ID is unknown, already resolved, or
   * claimed by a concurrent caller.
   */
  async reject(
    approvalId: string,
    options?: { reason?: string; signal?: AbortSignal },
  ): Promise<AgentResult | ToolExecutionResult> {
    const pending = await this.store.claim(approvalId);

    if (!pending) {
      throw new ApprovalNotFoundError(approvalId);
    }

    return this.runner.settleApproval(
      pending,
      { approved: false, reason: options?.reason },
      options,
    );
  }
}
