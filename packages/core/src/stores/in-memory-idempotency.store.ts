import type { IdempotencyRecord, IdempotencyStore } from '../interfaces/idempotency.interface';

/**
 * In-memory implementation of `IdempotencyStore` for development and testing.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, string>();

  /**
   * Retrieves a stored idempotency record.
   * @param key Unique idempotency key.
   */
  async get<T = unknown>(key: string): Promise<IdempotencyRecord<T> | null> {
    const raw = this.store.get(key);
    if (!raw) return null;
    return this.deserialize<T>(raw);
  }

  /**
   * Saves an idempotency record as a serialized JSON snapshot.
   * @param record Record to persist.
   */
  async save<T = unknown>(record: IdempotencyRecord<T>): Promise<void> {
    this.store.set(key(record.key), JSON.stringify(record));
  }

  /**
   * Deletes an idempotency record.
   * @param key Unique idempotency key.
   */
  async delete(keyStr: string): Promise<void> {
    this.store.delete(key(keyStr));
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

function key(k: string): string {
  return k;
}
