import type { ApprovalStore, PendingApproval } from '../interfaces';

/**
 * In-memory implementation of ApprovalStore.
 * Suitable for development and testing. Not suitable for production
 * or multi-instance deployments — use a persistent store (e.g. Redis) instead.
 *
 * Records are stored as serialized snapshots rather than live references, so
 * this store behaves like a persistent one: callers cannot mutate stored state
 * by holding onto a returned record, and a value that would not survive a real
 * store fails here too instead of appearing to work in development.
 */
export class InMemoryApprovalStore implements ApprovalStore {
  private readonly store = new Map<string, string>();

  async save(approval: PendingApproval): Promise<void> {
    this.store.set(approval.id, JSON.stringify(approval));
  }

  async get(id: string): Promise<PendingApproval | null> {
    return this.deserialize(this.store.get(id));
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  /**
   * Atomic within a single process: the read and delete run synchronously in
   * one event-loop tick, so two concurrent `claim()` calls for the same id
   * cannot both observe the approval. Only the first returns the record; the
   * rest return `null`. Multi-instance deployments must use a store backed by
   * a shared atomic primitive (e.g. `RedisApprovalStore`).
   */
  async claim(id: string): Promise<PendingApproval | null> {
    const raw = this.store.get(id);
    if (raw === undefined) return null;
    this.store.delete(id);
    return this.deserialize(raw);
  }

  private deserialize(raw: string | undefined): PendingApproval | null {
    if (raw === undefined) return null;

    const parsed = JSON.parse(raw) as PendingApproval;
    // Dates do not round-trip through JSON, so they are restored here, matching
    // what a persistent store has to do.
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : undefined,
    };
  }
}
