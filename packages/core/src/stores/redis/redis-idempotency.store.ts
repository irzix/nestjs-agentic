import { Injectable } from '@nestjs/common';
import type { IdempotencyRecord, IdempotencyStore } from '../../interfaces/idempotency.interface';
import type { GenericRedisClient } from './redis-state.store';

export interface RedisIdempotencyStoreOptions {
  /** Generic Redis client instance. */
  client: GenericRedisClient;
  /** Key prefix for stored Redis keys. Defaults to 'agentic:idempotency:'. */
  keyPrefix?: string;
  /** Fallback TTL in seconds for idempotency keys. */
  ttlSeconds?: number;
}

/**
 * Redis-backed `IdempotencyStore` for distributed tool call deduplication.
 */
@Injectable()
export class RedisIdempotencyStore implements IdempotencyStore {
  private readonly client: GenericRedisClient;
  private readonly keyPrefix: string;
  private readonly ttlSeconds?: number;

  constructor(options: RedisIdempotencyStoreOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'agentic:idempotency:';
    this.ttlSeconds = options.ttlSeconds;
  }

  private getKey(id: string): string {
    return `${this.keyPrefix}${id}`;
  }

  /**
   * Retrieves an idempotency record from Redis.
   * @param key Unique idempotency key.
   */
  async get<T = unknown>(key: string): Promise<IdempotencyRecord<T> | null> {
    const raw = await this.client.get(this.getKey(key));
    if (!raw) return null;
    return this.deserialize<T>(raw);
  }

  /**
   * Stores an idempotency record in Redis with optional TTL.
   * @param record Record to persist.
   */
  async save<T = unknown>(record: IdempotencyRecord<T>): Promise<void> {
    const serialized = JSON.stringify(record);
    const redisKey = this.getKey(record.key);
    const ttl = this.resolveTtl(record);

    if (ttl !== undefined) {
      await this.client.set(redisKey, serialized, 'EX', ttl);
    } else {
      await this.client.set(redisKey, serialized);
    }
  }

  /**
   * Deletes an idempotency record from Redis.
   * @param key Unique idempotency key.
   */
  async delete(key: string): Promise<void> {
    await this.client.del(this.getKey(key));
  }

  private resolveTtl(record: IdempotencyRecord): number | undefined {
    if (record.expiresAt) {
      const ms = new Date(record.expiresAt).getTime() - Date.now();
      return Math.max(Math.ceil(ms / 1000), 1);
    }
    return this.ttlSeconds;
  }

  private deserialize<T>(raw: string): IdempotencyRecord<T> | null {
    try {
      const parsed = JSON.parse(raw);
      return {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : undefined,
      };
    } catch {
      return null;
    }
  }
}
