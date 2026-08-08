import type { AgentContext } from './agent-context.interface';

export interface PendingApproval {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  context: AgentContext;
  reason: string;
  createdAt: Date;
  /** The tool closure to invoke once the approval is granted. */
  execute: () => Promise<unknown>;
}

export interface ApprovalStore {
  save(approval: PendingApproval): Promise<void>;
  get(id: string): Promise<PendingApproval | null>;
  delete(id: string): Promise<void>;
}
