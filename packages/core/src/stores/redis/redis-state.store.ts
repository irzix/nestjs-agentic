import { Injectable } from '@nestjs/common';
import type { StateStore } from '../../interfaces/state-store.interface';

export interface GenericRedisClient {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode?: string,
    duration?: number,
    flag?: string,
  ): Promise<unknown>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  /**
   * Atomically get and delete a key (Redis 6.2+ `GETDEL`). Optional because
   * not every client exposes it; `RedisApprovalStore` uses it for atomic
   * claiming when present and falls back to a non-atomic get+del otherwise.
   */
  getdel?(key: string): Promise<string | null>;
}

export interface RedisStateStoreOptions {
  client: GenericRedisClient;
  keyPrefix?: string;
}

@Injectable()
export class RedisStateStore implements StateStore {
  private readonly client: GenericRedisClient;
  private readonly keyPrefix: string;

  constructor(options: RedisStateStoreOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'agentic:state:';
  }

  private getKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.client.get(this.getKey(key));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const redisKey = this.getKey(key);

    if (ttlSeconds) {
      await this.client.set(redisKey, serialized, 'EX', ttlSeconds);
    } else {
      await this.client.set(redisKey, serialized);
    }
  }

  async setIfNotExists<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const redisKey = this.getKey(key);

    if (ttlSeconds) {
      const res = await this.client.set(redisKey, serialized, 'EX', ttlSeconds, 'NX');
      return res === 'OK' || res === 1 || res === true;
    } else {
      const res = await this.client.set(redisKey, serialized, 'NX');
      return res === 'OK' || res === 1 || res === true;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.getKey(key));
  }

  async clear(prefix?: string): Promise<void> {
    const pattern = `${this.keyPrefix}${prefix ?? ''}*`;
    const keys = await this.client.keys(pattern);
    for (const key of keys) {
      await this.client.del(key);
    }
  }
}
