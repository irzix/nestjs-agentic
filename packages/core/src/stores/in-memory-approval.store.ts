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

  /**
   * Atomic within a single process: the get and delete run synchronously in
   * one event-loop tick, so two concurrent `claim()` calls for the same id
   * cannot both observe the approval. Only the first returns the record; the
   * rest return `null`. Multi-instance deployments must use a store backed by
   * a shared atomic primitive (e.g. `RedisApprovalStore`).
   */
  async claim(id: string): Promise<PendingApproval | null> {
    const approval = this.store.get(id);
    if (!approval) return null;
    this.store.delete(id);
    return approval;
  }
}
