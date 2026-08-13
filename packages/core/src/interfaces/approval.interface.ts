import type { AgentContext } from './agent-context.interface';
import type { ModelMessage } from './model.interface';

/** Checkpoint schema version written by this release. */
export const APPROVAL_CHECKPOINT_VERSION = 1;

/**
 * A durable snapshot of the suspended turn, stored on the approval itself.
 *
 * Resuming needs the conversation up to and including the tool message that
 * was withheld. Reading it back from `SessionStore` is unreliable — that
 * transcript is trimmed for replay and may be cleared independently of the
 * approval — so the executor checkpoints it here instead, making resume
 * self-contained.
 *
 * `version` is explicit so a record written by an older release can be
 * recognized and rejected (`ApprovalCheckpointVersionError`) rather than
 * misread.
 */
export interface ApprovalCheckpoint {
  version: number;
  /**
   * Conversation up to and including the withheld tool message, untrimmed and
   * without system messages — instructions are re-derived from the agent's
   * `AgentConfig` on resume.
   */
  messages: ModelMessage[];
}

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
  /**
   * Snapshot of the suspended turn, written by the built-in runtime once the
   * approval is created. When present, resuming uses it instead of reading
   * `SessionStore`, so the turn survives history being trimmed or cleared.
   * Absent for approvals created outside the built-in runtime.
   */
  checkpoint?: ApprovalCheckpoint;
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
