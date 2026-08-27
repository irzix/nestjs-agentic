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
 * cannot rewrite history even though the chain would reveal it. Those grants
 * exclude `CREATE`, so pair them with `autoCreateTable: false` and create the
 * table from a migration run by a privileged role.
 *
 * Row identity (`id`) is database-generated and independent of chain position
 * (`chain_sequence`), so direct and chained writes can share one table without
 * competing.
 *
 * A chain requires a single append authority. `chain_sequence` is `UNIQUE`, which
 * catches two writers picking the *same* position, but not divergence: writers
 * that resumed from the same head and picked different positions both insert
 * successfully, and the break only surfaces when `verifyAuditChain` reports a
 * predecessor mismatch. Either keep one writer per chain, or assign
 * `chain_sequence` and `previousHash` inside a transaction that locks the head.
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

  constructor(options: PostgresAuditSinkOptions) {
    this.client = options.client;
    this.tableName = validateSqlIdentifier(options.tableName ?? 'agentic_audit_events');
    this.autoCreateTable = options.autoCreateTable ?? true;
  }

  private ensureTable(): Promise<void> {
    if (!this.autoCreateTable) return Promise.resolve();
    if (!this.tableInitPromise) {
      // A failure is not cached: a transient outage on the first write would
      // otherwise leave the table uncreated for the lifetime of the instance.
      this.tableInitPromise = this.createTable().catch((err: unknown) => {
        this.tableInitPromise = undefined;
        throw err;
      });
    }
    return this.tableInitPromise;
  }

  private async createTable(): Promise<void> {
    try {
      await this.client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id BIGSERIAL PRIMARY KEY,
          chain_sequence BIGINT UNIQUE,
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
      // Tolerate a concurrent creator, but let every other failure surface —
      // including errors that carry no `code` at all, such as a dropped connection.
      const code = (err as { code?: string } | null)?.code;
      if (code === '42P07' || code === '42710') return;
      throw err;
    }
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

    // Row identity is database-generated, so an unchained write never competes
    // with a chain position.
    await this.insert(event, null);
  }

  private async insert(
    event: AuditEvent,
    chainSequence: number | null,
    previousHash?: string,
    hash?: string,
  ): Promise<void> {
    await this.ensureTable();

    await this.client.query(
      `INSERT INTO ${this.tableName}
         (chain_sequence, type, session_id, trace_id, tenant_id, at, event, previous_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        chainSequence,
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

    // Restricted to chained rows: an unchained event written afterwards must not
    // hide an existing chain and silently restart it from genesis.
    const result = await this.client.query<{ hash: string | null; chain_sequence: string | number }>(
      `SELECT hash, chain_sequence FROM ${this.tableName}
       WHERE hash IS NOT NULL AND chain_sequence IS NOT NULL
       ORDER BY chain_sequence DESC LIMIT 1`,
    );

    const row = result.rows[0];
    if (!row?.hash) return {};

    return { previousHash: row.hash, startSequence: Number(row.chain_sequence) };
  }

  /**
   * Reads stored entries in chain order, for passing to `verifyAuditChain`.
   *
   * @param limit Maximum rows to read, oldest first. Omit to read the whole chain.
   */
  async readChain(limit?: number): Promise<ChainedAuditEntry[]> {
    await this.ensureTable();

    const result = await this.client.query<{
      chain_sequence: string | number;
      event: unknown;
      previous_hash: string | null;
      hash: string | null;
    }>(
      `SELECT chain_sequence, event, previous_hash, hash FROM ${this.tableName}
       WHERE hash IS NOT NULL AND chain_sequence IS NOT NULL
       ORDER BY chain_sequence ASC${limit !== undefined ? ' LIMIT $1' : ''}`,
      limit !== undefined ? [limit] : undefined,
    );

    return result.rows.map((row) => {
      const event = reviveAuditEvent(row.event);
      return {
        sequence: Number(row.chain_sequence),
        event,
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

/**
 * Rebuilds a stored event, validating the fields verification depends on rather
 * than trusting the row's shape. `at` is revived to a `Date` so a recomputed hash
 * matches the one produced at write time.
 *
 * @throws {Error} If the row is not a well-formed audit event.
 */
function reviveAuditEvent(raw: unknown): AuditEvent {
  const parsed: unknown = safeDeserialize(raw);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('PostgresAuditSink: stored audit row is not an object.');
  }

  const candidate = parsed as Record<string, unknown>;
  for (const field of ['type', 'sessionId', 'traceId'] as const) {
    if (typeof candidate[field] !== 'string') {
      throw new Error(`PostgresAuditSink: stored audit row is missing a string "${field}".`);
    }
  }

  const at = new Date(candidate.at as string);
  if (Number.isNaN(at.getTime())) {
    throw new Error('PostgresAuditSink: stored audit row has an invalid "at" timestamp.');
  }

  return { ...candidate, at } as AuditEvent;
}
