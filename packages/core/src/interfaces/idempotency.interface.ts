import type { ToolExecutionResult } from './tool.interface';

/**
 * Cached execution record for an idempotent tool call.
 */
export interface IdempotencyRecord<T = unknown> {
  key: string;
  toolName?: string;
  result: ToolExecutionResult<T>;
  createdAt: Date;
  expiresAt?: Date;
}

/**
 * Storage interface for managing tool execution idempotency records.
 */
export interface IdempotencyStore {
  /**
   * Retrieves a stored idempotency record by key.
   * @param key Unique idempotency key.
   */
  get<T = unknown>(key: string): Promise<IdempotencyRecord<T> | null>;

  /**
   * Saves a tool execution result under the idempotency key.
   * @param record Idempotency record to store.
   */
  save<T = unknown>(record: IdempotencyRecord<T>): Promise<void>;

  /**
   * Deletes an idempotency record.
   * @param key Unique idempotency key.
   */
  delete(key: string): Promise<void>;
}
