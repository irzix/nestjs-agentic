import { Inject, Injectable } from '@nestjs/common';
import { APPROVAL_STORE } from '../constants';
import type { ApprovalStore, ToolExecutionResult } from '../interfaces';

@Injectable()
export class ApprovalService {
  constructor(
    @Inject(APPROVAL_STORE) private readonly store: ApprovalStore,
  ) {}

  /**
   * Executes the pending tool closure associated with the given approval ID
   * and removes it from the store. Throws if the ID is not found.
   */
  async approve(approvalId: string): Promise<ToolExecutionResult> {
    const pending = await this.store.get(approvalId);

    if (!pending) {
      throw new Error(
        `Approval "${approvalId}" not found or has already been processed.`,
      );
    }

    const result = await pending.execute();
    await this.store.delete(approvalId);
    return result as ToolExecutionResult;
  }

  /**
   * Rejects and removes a pending approval request without executing it.
   * Throws if the ID is not found.
   */
  async reject(approvalId: string): Promise<void> {
    const pending = await this.store.get(approvalId);

    if (!pending) {
      throw new Error(
        `Approval "${approvalId}" not found or has already been processed.`,
      );
    }

    await this.store.delete(approvalId);
  }
}
