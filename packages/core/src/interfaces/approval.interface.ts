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
}

/** A human reviewer's decision on a `PendingApproval`. */
export type ApprovalDecision = { approved: true } | { approved: false; reason?: string };
