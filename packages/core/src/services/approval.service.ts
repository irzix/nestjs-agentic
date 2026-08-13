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
   * Throws `ApprovalNotFoundError` if the ID is unknown or already resolved.
   */
  async approve(
    approvalId: string,
    options?: { signal?: AbortSignal },
  ): Promise<AgentResult | ToolExecutionResult> {
    const pending = await this.store.get(approvalId);

    if (!pending) {
      throw new ApprovalNotFoundError(approvalId);
    }

    const result = await this.runner.settleApproval(pending, { approved: true }, options);
    await this.store.delete(approvalId);
    return result;
  }

  /**
   * Rejects a pending approval and removes it from the store. When the
   * approval suspended the built-in runtime's model loop, the turn resumes
   * with a `denied` outcome so the model can recover within the same
   * conversation instead of the turn simply disappearing.
   *
   * Throws `ApprovalNotFoundError` if the ID is unknown or already resolved.
   */
  async reject(
    approvalId: string,
    options?: { reason?: string; signal?: AbortSignal },
  ): Promise<AgentResult | ToolExecutionResult> {
    const pending = await this.store.get(approvalId);

    if (!pending) {
      throw new ApprovalNotFoundError(approvalId);
    }

    const result = await this.runner.settleApproval(
      pending,
      { approved: false, reason: options?.reason },
      options,
    );
    await this.store.delete(approvalId);
    return result;
  }
}
