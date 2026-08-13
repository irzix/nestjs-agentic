import type { AgentContext } from './agent-context.interface';

/**
 * A tool call withheld pending human approval.
 *
 * Fully serializable so a store can persist it across a process restart or a
 * different instance — there is no closure over live objects. Resuming a
 * pending approval re-resolves the agent, its tools, and the tool method
 * through DI using `agentName` and `toolName` rather than a captured
 * reference.
 */
export interface PendingApproval {
  id: string;
  /** Name of the @Agent that requested this call, used to resume its turn. */
  agentName: string;
  toolName: string;
  args: Record<string, unknown>;
  context: AgentContext;
  reason: string;
  createdAt: Date;
  /**
   * When set, the approval is no longer valid after this instant. Attempting
   * to resolve it past this point fails with `ApprovalExpiredError` rather
   * than executing a decision against stale context. Unset means the approval
   * never expires. Derived from a policy's `ttlSeconds` or the module's
   * `approvalTtlSeconds` when the approval is created.
   */
  expiresAt?: Date;
  /**
   * Identifier of the model tool call this approval corresponds to, when
   * known. Used to splice the eventual outcome back into the exact
   * conversation position that was suspended.
   */
  toolCallId?: string;
}

export interface ApprovalStore {
  save(approval: PendingApproval): Promise<void>;
  get(id: string): Promise<PendingApproval | null>;
  delete(id: string): Promise<void>;
  /**
   * Atomically remove and return the approval, or return `null` if it is
   * absent — including because a concurrent caller already claimed it.
   *
   * This is the primitive that makes settlement exactly-once: `approve()` and
   * `reject()` claim an approval before executing its withheld tool, so a
   * given approval can be settled at most once even under concurrent calls or
   * a restart-triggered retry. Implementations MUST perform the read and
   * removal as a single atomic step (e.g. Redis `GETDEL`).
   */
  claim(id: string): Promise<PendingApproval | null>;
}

/** A human reviewer's decision on a `PendingApproval`. */
export type ApprovalDecision = { approved: true } | { approved: false; reason?: string };
