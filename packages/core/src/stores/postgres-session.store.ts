import { Injectable } from '@nestjs/common';
import type { SessionStore } from '../interfaces/session.interface';
import type { GenericPostgresClient } from './postgres-state.store';

export interface PostgresSessionStoreOptions {
  /** Database client or pool connection instance. */
  client: GenericPostgresClient;
  /** Table name for session persistence. Defaults to 'agentic_sessions'. */
  tableName?: string;
  /** Key prefix for stored session keys. Defaults to 'agentic:session:'. */
  keyPrefix?: string;
  /** Optional TTL in seconds for stored session keys. */
  ttlSeconds?: number;
  /** Automatically ensure the session table exists on first query. Default: true */
  autoCreateTable?: boolean;
}

/**
 * PostgreSQL-backed `SessionStore` for persisting conversation transcripts.
 */
@Injectable()
export class PostgresSessionStore implements SessionStore {
  private readonly client: GenericPostgresClient;
  private readonly tableName: string;
  private readonly keyPrefix: string;
  private readonly ttlSeconds?: number;
  private readonly autoCreateTable: boolean;
  private tableInitialized = false;

  constructor(options: PostgresSessionStoreOptions) {
    this.client = options.client;
    this.tableName = options.tableName ?? 'agentic_sessions';
    this.keyPrefix = options.keyPrefix ?? 'agentic:session:';
    this.ttlSeconds = options.ttlSeconds;
    this.autoCreateTable = options.autoCreateTable ?? true;
  }

  private getKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  private async ensureTable(): Promise<void> {
    if (!this.autoCreateTable || this.tableInitialized) return;
    try {
      await this.client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          session_id VARCHAR(255) PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expires ON ${this.tableName} (expires_at);
      `);
    } catch {
      // Table might already exist
    }
    this.tableInitialized = true;
  }

  async get(sessionId: string): Promise<unknown | null> {
    await this.ensureTable();
    const key = this.getKey(sessionId);
    const result = await this.client.query(
      `SELECT data FROM ${this.tableName} WHERE session_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [key],
    );

    if (result.rows.length === 0) return null;
    const raw = result.rows[0].data;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return JSON.parse(JSON.stringify(parsed));
  }

  async set(sessionId: string, data: unknown): Promise<void> {
    await this.ensureTable();
    const key = this.getKey(sessionId);
    const serialized = JSON.stringify(data);
    const expiresAt = this.ttlSeconds ? new Date(Date.now() + this.ttlSeconds * 1000) : null;

    await this.client.query(
      `INSERT INTO ${this.tableName} (session_id, data, updated_at, expires_at)
       VALUES ($1, $2::jsonb, NOW(), $3)
       ON CONFLICT (session_id) DO UPDATE
       SET data = EXCLUDED.data, updated_at = NOW(), expires_at = EXCLUDED.expires_at`,
      [key, serialized, expiresAt],
    );
  }

  async delete(sessionId: string): Promise<void> {
    await this.ensureTable();
    const key = this.getKey(sessionId);
    await this.client.query(`DELETE FROM ${this.tableName} WHERE session_id = $1`, [key]);
  }
}
