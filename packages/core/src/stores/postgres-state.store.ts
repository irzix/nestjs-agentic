import { Injectable } from '@nestjs/common';
import type { StateStore } from '../interfaces/state-store.interface';

/**
 * Generic interface for PostgreSQL database clients or connection pools
 * (compatible with `pg.Pool`, `pg.Client`, TypeORM QueryRunner, Kysely, Slonik).
 */
export interface GenericPostgresClient {
  query<R = any>(queryText: string, values?: any[]): Promise<{ rows: R[]; rowCount?: number }>;
}

export interface PostgresStateStoreOptions {
  /** Database client or pool connection instance. */
  client: GenericPostgresClient;
  /** Table name for state persistence. Defaults to 'agentic_state'. */
  tableName?: string;
  /** Key prefix for stored keys. Defaults to 'agentic:state:'. */
  keyPrefix?: string;
  /** Automatically ensure the state table exists on first query. Default: true */
  autoCreateTable?: boolean;
}

/**
 * PostgreSQL-backed `StateStore` for persisting runtime state and in-flight checkpoints.
 */
@Injectable()
export class PostgresStateStore implements StateStore {
  private readonly client: GenericPostgresClient;
  private readonly tableName: string;
  private readonly keyPrefix: string;
  private readonly autoCreateTable: boolean;
  private tableInitialized = false;

  constructor(options: PostgresStateStoreOptions) {
    this.client = options.client;
    this.tableName = options.tableName ?? 'agentic_state';
    this.keyPrefix = options.keyPrefix ?? 'agentic:state:';
    this.autoCreateTable = options.autoCreateTable ?? true;
  }

  private getKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private async ensureTable(): Promise<void> {
    if (!this.autoCreateTable || this.tableInitialized) return;
    try {
      await this.client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          key VARCHAR(255) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expires ON ${this.tableName} (expires_at);
      `);
    } catch {
      // Table might already exist or concurrent creation
    }
    this.tableInitialized = true;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    await this.ensureTable();
    const fullKey = this.getKey(key);
    const result = await this.client.query(
      `SELECT value, expires_at FROM ${this.tableName} WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [fullKey],
    );

    if (result.rows.length === 0) return null;
    const raw = result.rows[0].value;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.ensureTable();
    const fullKey = this.getKey(key);
    const serialized = JSON.stringify(value);
    const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;

    await this.client.query(
      `INSERT INTO ${this.tableName} (key, value, updated_at, expires_at)
       VALUES ($1, $2::jsonb, NOW(), $3)
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW(), expires_at = EXCLUDED.expires_at`,
      [fullKey, serialized, expiresAt],
    );
  }

  async delete(key: string): Promise<void> {
    await this.ensureTable();
    const fullKey = this.getKey(key);
    await this.client.query(`DELETE FROM ${this.tableName} WHERE key = $1`, [fullKey]);
  }

  async clear(prefix?: string): Promise<void> {
    await this.ensureTable();
    const pattern = `${this.keyPrefix}${prefix ?? ''}%`;
    await this.client.query(`DELETE FROM ${this.tableName} WHERE key LIKE $1`, [pattern]);
  }
}
