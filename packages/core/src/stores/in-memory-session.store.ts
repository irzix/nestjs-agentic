import type { SessionStore } from '../interfaces';

/**
 * In-memory implementation of SessionStore.
 * Suitable for development and testing. Not suitable for production
 * or multi-instance deployments — use a persistent store (e.g. Redis) instead.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly store = new Map<string, unknown>();

  async get(sessionId: string): Promise<unknown | null> {
    return this.store.get(sessionId) ?? null;
  }

  async set(sessionId: string, data: unknown): Promise<void> {
    this.store.set(sessionId, data);
  }

  async delete(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
  }
}
