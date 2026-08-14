import { Injectable } from '@nestjs/common';
import type { SessionStore } from '../interfaces/session.interface';
import type { GenericRedisClient } from './redis-state.store';

export interface RedisSessionStoreOptions {
  /** Generic Redis client instance exposing get, set, del. */
  client: GenericRedisClient;
  /** Key prefix for stored Redis keys. Defaults to 'agentic:session:'. */
  keyPrefix?: string;
  /** Optional TTL in seconds for stored session keys in Redis. */
  ttlSeconds?: number;
}

/**
 * Redis-backed `SessionStore` for persisting conversation transcripts.
 *
 * Persists session records across application restarts and multi-instance
 * deployments, scoped by tenant.
 */
@Injectable()
export class RedisSessionStore implements SessionStore {
  private readonly client: GenericRedisClient;
  private readonly keyPrefix: string;
  private readonly ttlSeconds?: number;

  constructor(options: RedisSessionStoreOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'agentic:session:';
    this.ttlSeconds = options.ttlSeconds;
  }

  private getKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  /**
   * Retrieves stored session data by session identifier.
   *
   * @param sessionId The scoped session key (e.g. `tenant:sessionId` or `sessionId`).
   * @returns The parsed session record or null if not found.
   */
  async get(sessionId: string): Promise<unknown | null> {
    const raw = await this.client.get(this.getKey(sessionId));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  /**
   * Stores session data with optional TTL expiration.
   *
   * @param sessionId The scoped session key.
   * @param data The serializable session record or data payload.
   */
  async set(sessionId: string, data: unknown): Promise<void> {
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    const key = this.getKey(sessionId);

    if (this.ttlSeconds !== undefined) {
      await this.client.set(key, serialized, 'EX', this.ttlSeconds);
    } else {
      await this.client.set(key, serialized);
    }
  }

  /**
   * Deletes session data for the given session identifier.
   *
   * @param sessionId The scoped session key to delete.
   */
  async delete(sessionId: string): Promise<void> {
    await this.client.del(this.getKey(sessionId));
  }
}
