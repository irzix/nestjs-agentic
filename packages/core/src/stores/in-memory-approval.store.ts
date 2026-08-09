import type { ApprovalStore, PendingApproval } from '../interfaces';

/**
 * In-memory implementation of ApprovalStore.
 * Suitable for development and testing. Not suitable for production
 * or multi-instance deployments — use a persistent store (e.g. Redis) instead.
 */
export class InMemoryApprovalStore implements ApprovalStore {
  private readonly store = new Map<string, PendingApproval>();

  async save(approval: PendingApproval): Promise<void> {
    this.store.set(approval.id, approval);
  }

  async get(id: string): Promise<PendingApproval | null> {
    return this.store.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
