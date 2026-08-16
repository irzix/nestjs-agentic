import { Injectable } from '@nestjs/common';
import type { ApprovalStore, PendingApproval } from '../../interfaces/approval.interface';
import type { GenericPostgresClient } from './postgres-state.store';
import { safeDeserialize, validateSqlIdentifier } from './postgres-utils';

export interface PostgresApprovalStoreOptions {
  /** Database client or pool connection instance. */
  client: GenericPostgresClient;
  /** Table name for approvals persistence. Defaults to 'agentic_approvals'. */
  tableName?: string;
  /** Key prefix for stored approval identifiers. Defaults to ''. */
  keyPrefix?: string;
  /** Fallback lifetime in seconds for approvals without their own expiresAt. */
  ttlSeconds?: number;
  /** Extra seconds to retain expired approvals for exact ApprovalExpiredError reporting. Defaults to 300. */
  expiryGraceSeconds?: number;
  /** Automatically ensure the approvals table exists on first query. Default: true */
  autoCreateTable?: boolean;
}

/**
 * PostgreSQL-backed `ApprovalStore`.
 *
 * Implements atomic, exactly-once claiming using PostgreSQL single-statement `DELETE ... RETURNING`.
 */
@Injectable()
export class PostgresApprovalStore implements ApprovalStore {
  private readonly client: GenericPostgresClient;
  private readonly tableName: string;
  private readonly keyPrefix: string;
  private readonly ttlSeconds?: number;
  private readonly expiryGraceSeconds: number;
  private readonly autoCreateTable: boolean;
  private tableInitPromise?: Promise<void>;

  constructor(options: PostgresApprovalStoreOptions) {
    this.client = options.client;
    this.tableName = validateSqlIdentifier(options.tableName ?? 'agentic_approvals');
    this.keyPrefix = options.keyPrefix ?? '';
    this.ttlSeconds = options.ttlSeconds;
    this.expiryGraceSeconds = options.expiryGraceSeconds ?? 300;
    this.autoCreateTable = options.autoCreateTable ?? true;
  }

  private getKey(id: string): string {
    return `${this.keyPrefix}${id}`;
  }

  private ensureTable(): Promise<void> {
    if (!this.autoCreateTable) return Promise.resolve();
    if (!this.tableInitPromise) {
      this.tableInitPromise = (async () => {
        try {
          await this.client.query(`
            CREATE TABLE IF NOT EXISTS ${this.tableName} (
              id VARCHAR(255) PRIMARY KEY,
              data JSONB NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              expires_at TIMESTAMPTZ
            );
            CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expires ON ${this.tableName} (expires_at) WHERE expires_at IS NOT NULL;
          `);
        } catch (err: any) {
          // Ignore Postgres "already exists" errors (42P07 for table, 42710 for index)
          if (err?.code && !['42P07', '42710'].includes(err.code)) {
            throw err;
          }
        }
      })();
    }
    return this.tableInitPromise;
  }

  async save(approval: PendingApproval): Promise<void> {
    await this.ensureTable();
    const key = this.getKey(approval.id);
    const serialized = JSON.stringify(approval);
    const expiresAt = this.resolveDbExpiresAt(approval);

    await this.client.query(
      `INSERT INTO ${this.tableName} (id, data, created_at, expires_at)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (id) DO UPDATE
       SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
      [key, serialized, approval.createdAt ?? new Date(), expiresAt],
    );
  }

  private resolveDbExpiresAt(approval: PendingApproval): Date | null {
    if (approval.expiresAt) {
      const ms = new Date(approval.expiresAt).getTime() + this.expiryGraceSeconds * 1000;
      return new Date(ms);
    }
    if (this.ttlSeconds !== undefined) {
      return new Date(Date.now() + this.ttlSeconds * 1000);
    }
    return null;
  }

  async get(id: string): Promise<PendingApproval | null> {
    await this.ensureTable();
    const key = this.getKey(id);
    const result = await this.client.query(
      `SELECT data FROM ${this.tableName} WHERE id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [key],
    );

    if (result.rows.length === 0) return null;
    return this.deserialize(result.rows[0].data);
  }

  async delete(id: string): Promise<void> {
    await this.ensureTable();
    const key = this.getKey(id);
    await this.client.query(`DELETE FROM ${this.tableName} WHERE id = $1`, [key]);
  }

  async claim(id: string): Promise<PendingApproval | null> {
    await this.ensureTable();
    const key = this.getKey(id);
    const result = await this.client.query(
      `DELETE FROM ${this.tableName} WHERE id = $1 AND (expires_at IS NULL OR expires_at > NOW()) RETURNING data`,
      [key],
    );

    if (result.rows.length === 0) return null;
    return this.deserialize(result.rows[0].data);
  }

  private deserialize(raw: unknown): PendingApproval | null {
    if (!raw) return null;
    const parsed = safeDeserialize<PendingApproval>(raw);
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : undefined,
    };
  }
}
