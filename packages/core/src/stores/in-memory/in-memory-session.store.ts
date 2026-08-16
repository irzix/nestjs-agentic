import type { SessionStore } from '../../interfaces';

/**
 * In-memory implementation of SessionStore.
 * Suitable for development and testing. Not suitable for production
 * or multi-instance deployments — use a persistent store (e.g. Redis) instead.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly store = new Map<string, string>();

  /**
   * Retrieves stored session data by session identifier.
   *
   * @param sessionId The scoped session key.
   * @returns The parsed session record or null if not found.
   */
  async get(sessionId: string): Promise<unknown | null> {
    const raw = this.store.get(sessionId);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  /**
   * Stores session data as a serialized JSON snapshot.
   *
   * @param sessionId The scoped session key.
   * @param data The serializable session record or data payload.
   */
  async set(sessionId: string, data: unknown): Promise<void> {
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    this.store.set(sessionId, serialized);
  }

  /**
   * Deletes session data for the given session identifier.
   *
   * @param sessionId The scoped session key to delete.
   */
  async delete(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
  }
}
