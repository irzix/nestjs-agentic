import { Injectable } from '@nestjs/common';
import type { StateStore } from '../interfaces/state-store.interface';

@Injectable()
export class InMemoryStateStore implements StateStore {
  private readonly storage = new Map<string, { value: unknown; expiresAt?: number }>();

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.storage.get(key);
    if (!entry) return null;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.storage.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.storage.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }

  async clear(prefix?: string): Promise<void> {
    if (!prefix) {
      this.storage.clear();
      return;
    }

    for (const key of this.storage.keys()) {
      if (key.startsWith(prefix)) {
        this.storage.delete(key);
      }
    }
  }
}
