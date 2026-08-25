import { Injectable } from '@nestjs/common';

import type { AuditEvent, AuditSink } from '../interfaces/audit.interface';
import type { GenericPostgresClient } from '../stores/postgres/postgres-state.store';
import { safeDeserialize, validateSqlIdentifier } from '../stores/postgres/postgres-utils';
import type { ChainedAuditEntry, ChainedAuditEntrySink } from './hash-chain-audit.sink';

export interface PostgresAuditSinkOptions {
  /** Database client or pool connection instance. */
  client: GenericPostgresClient;
  /** Table name for audit persistence. Defaults to `'agentic_audit_events'`. */
  tableName?: string;
  /** Automatically ensure the audit table exists on first write. Default: `true` */
  autoCreateTable?: boolean;
}

/** A stored audit row, including chain columns when written through a hash chain. */
export interface PostgresAuditRow {
  sequence: number;
  type: string;
  sessionId: string;
  traceId: string;
  tenantId?: string;
  at: Date;
  event: AuditEvent;
  previousHash?: string;
  hash?: string;
}

/**
 * PostgreSQL-backed audit destination.
 *
 * Implements both contracts:
 *
 * - `AuditSink` — register through the `AUDIT_SINKS` token to persist events directly.
 * - `ChainedAuditEntrySink` — pass to `HashChainAuditSink` to persist a tamper-evident
 *   chain, storing each entry's `previousHash`/`hash` alongside the event.
 *
 * The table is treated as append-only: this class only ever inserts. Making that
 * a real guarantee is a database-level concern — grant the application role
 * `INSERT` and `SELECT` but not `UPDATE`/`DELETE`, so a compromised application
 * cannot rewrite history even though the chain would reveal it.
 *
 * @example
 * ```typescript
 * const sink = new PostgresAuditSink({ client: pool });
 * const chained = new HashChainAuditSink(sink, {
 *   // resume the existing chain across restarts
 *   ...(await sink.head()),
 * });
 * ```
 */
@Injectable()
export class PostgresAuditSink implements AuditSink, ChainedAuditEntrySink {
  private readonly client: GenericPostgresClient;
  private readonly tableName: string;
  private readonly autoCreateTable: boolean;
  private tableInitPromise?: Promise<void>;
  /** Fallback counter for direct `AuditSink` writes, which carry no sequence. */
  private unchainedSequence = 0;

  constructor(options: PostgresAuditSinkOptions) {
    this.client = options.client;
    this.tableName = validateSqlIdentifier(options.tableName ?? 'agentic_audit_events');
    this.autoCreateTable = options.autoCreateTable ?? true;
  }

  private ensureTable(): Promise<void> {
    if (!this.autoCreateTable) return Promise.resolve();
    if (!this.tableInitPromise) {
      this.tableInitPromise = (async () => {
        try {
          await this.client.query(`
            CREATE TABLE IF NOT EXISTS ${this.tableName} (
              sequence BIGINT PRIMARY KEY,
              type VARCHAR(64) NOT NULL,
              session_id VARCHAR(255) NOT NULL,
              trace_id VARCHAR(255) NOT NULL,
              tenant_id VARCHAR(255),
              at TIMESTAMPTZ NOT NULL,
              event JSONB NOT NULL,
              previous_hash CHAR(64),
              hash CHAR(64)
            );
            CREATE INDEX IF NOT EXISTS idx_${this.tableName}_session ON ${this.tableName} (session_id);
            CREATE INDEX IF NOT EXISTS idx_${this.tableName}_tenant ON ${this.tableName} (tenant_id) WHERE tenant_id IS NOT NULL;
          `);
        } catch (err: unknown) {
          // Ignore Postgres "already exists" errors (42P07 table, 42710 index).
          const code = (err as { code?: string } | null)?.code;
          if (code && !['42P07', '42710'].includes(code)) {
            throw err;
          }
        }
      })();
    }
    return this.tableInitPromise;
  }

  /**
   * Persists an audit event with no chain columns.
   *
   * @param event The prepared audit event to store.
   */
  async record(event: AuditEvent | ChainedAuditEntry): Promise<void> {
    if (isChainedEntry(event)) {
      await this.insert(event.event, event.sequence, event.previousHash, event.hash);
      return;
    }

    this.unchainedSequence += 1;
    await this.insert(event, this.unchainedSequence);
  }

  private async insert(
    event: AuditEvent,
    sequence: number,
    previousHash?: string,
    hash?: string,
  ): Promise<void> {
    await this.ensureTable();

    await this.client.query(
      `INSERT INTO ${this.tableName}
         (sequence, type, session_id, trace_id, tenant_id, at, event, previous_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        sequence,
        event.type,
        event.sessionId,
        event.traceId,
        event.tenantId ?? null,
        event.at,
        JSON.stringify(event),
        previousHash ?? null,
        hash ?? null,
      ],
    );
  }

  /**
   * Reads the chain head, for resuming a `HashChainAuditSink` after a restart.
   *
   * @returns The last entry's hash and sequence, or `undefined` values when the
   *   table is empty — spreadable straight into `HashChainAuditSinkOptions`.
   */
  async head(): Promise<{ previousHash?: string; startSequence?: number }> {
    await this.ensureTable();

    const result = await this.client.query<{ hash: string | null; sequence: string | number }>(
      `SELECT hash, sequence FROM ${this.tableName} ORDER BY sequence DESC LIMIT 1`,
    );

    const row = result.rows[0];
    if (!row?.hash) return {};

    return { previousHash: row.hash, startSequence: Number(row.sequence) };
  }

  /**
   * Reads stored entries in chain order, for passing to `verifyAuditChain`.
   *
   * @param limit Maximum rows to read, oldest first. Omit to read the whole chain.
   */
  async readChain(limit?: number): Promise<ChainedAuditEntry[]> {
    await this.ensureTable();

    const result = await this.client.query<{
      sequence: string | number;
      event: unknown;
      previous_hash: string | null;
      hash: string | null;
    }>(
      `SELECT sequence, event, previous_hash, hash FROM ${this.tableName}
       WHERE hash IS NOT NULL
       ORDER BY sequence ASC${limit !== undefined ? ' LIMIT $1' : ''}`,
      limit !== undefined ? [limit] : undefined,
    );

    return result.rows.map((row) => {
      const event = safeDeserialize<AuditEvent>(row.event);
      return {
        sequence: Number(row.sequence),
        // Revived so a verification hash matches the one computed at write time,
        // where `at` was a Date.
        event: { ...event, at: new Date(event.at) } as AuditEvent,
        previousHash: row.previous_hash ?? '',
        hash: row.hash ?? '',
      };
    });
  }
}

/** Distinguishes a chained entry from a bare audit event. */
function isChainedEntry(value: AuditEvent | ChainedAuditEntry): value is ChainedAuditEntry {
  return 'hash' in value && 'sequence' in value && 'event' in value;
}
