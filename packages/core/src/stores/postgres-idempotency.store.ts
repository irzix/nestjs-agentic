import { Injectable } from '@nestjs/common';
import type { IdempotencyRecord, IdempotencyStore } from '../interfaces/idempotency.interface';
import type { GenericPostgresClient } from './postgres-state.store';

export interface PostgresIdempotencyStoreOptions {
  /** Database client or pool connection instance. */
  client: GenericPostgresClient;
  /** Table name for idempotency persistence. Defaults to 'agentic_idempotency'. */
  tableName?: string;
  /** Key prefix for stored idempotency keys. Defaults to 'agentic:idempotency:'. */
  keyPrefix?: string;
  /** Fallback TTL in seconds for idempotency keys. */
  ttlSeconds?: number;
  /** Automatically ensure the idempotency table exists on first query. Default: true */
  autoCreateTable?: boolean;
}

/**
 * PostgreSQL-backed `IdempotencyStore` for tool execution deduplication.
 */
@Injectable()
export class PostgresIdempotencyStore implements IdempotencyStore {
  private readonly client: GenericPostgresClient;
  private readonly tableName: string;
  private readonly keyPrefix: string;
  private readonly ttlSeconds?: number;
  private readonly autoCreateTable: boolean;
  private tableInitialized = false;

  constructor(options: PostgresIdempotencyStoreOptions) {
    this.client = options.client;
    this.tableName = options.tableName ?? 'agentic_idempotency';
    this.keyPrefix = options.keyPrefix ?? 'agentic:idempotency:';
    this.ttlSeconds = options.ttlSeconds;
    this.autoCreateTable = options.autoCreateTable ?? true;
  }

  private getKey(id: string): string {
    return `${this.keyPrefix}${id}`;
  }

  private async ensureTable(): Promise<void> {
    if (!this.autoCreateTable || this.tableInitialized) return;
    try {
      await this.client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          key VARCHAR(255) PRIMARY KEY,
          data JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expires ON ${this.tableName} (expires_at);
      `);
    } catch {
      // Table might already exist
    }
    this.tableInitialized = true;
  }

  async get<T = unknown>(key: string): Promise<IdempotencyRecord<T> | null> {
    await this.ensureTable();
    const fullKey = this.getKey(key);
    const result = await this.client.query(
      `SELECT data FROM ${this.tableName} WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [fullKey],
    );

    if (result.rows.length === 0) return null;
    return this.deserialize<T>(result.rows[0].data);
  }

  async save<T = unknown>(record: IdempotencyRecord<T>): Promise<void> {
    await this.ensureTable();
    const fullKey = this.getKey(record.key);
    const serialized = JSON.stringify(record);
    const expiresAt = this.resolveExpiresAt(record);

    await this.client.query(
      `INSERT INTO ${this.tableName} (key, data, created_at, expires_at)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (key) DO UPDATE
       SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
      [fullKey, serialized, record.createdAt ?? new Date(), expiresAt],
    );
  }

  async delete(key: string): Promise<void> {
    await this.ensureTable();
    const fullKey = this.getKey(key);
    await this.client.query(`DELETE FROM ${this.tableName} WHERE key = $1`, [fullKey]);
  }

  private resolveExpiresAt(record: IdempotencyRecord): Date | null {
    if (record.expiresAt) {
      return new Date(record.expiresAt);
    }
    if (this.ttlSeconds !== undefined) {
      return new Date(Date.now() + this.ttlSeconds * 1000);
    }
    return null;
  }

  private deserialize<T>(raw: unknown): IdempotencyRecord<T> | null {
    if (!raw) return null;
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw))) as IdempotencyRecord<T>;
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : undefined,
    };
  }
}
