import { Injectable } from '@nestjs/common';
import { requiredApprovalsOf } from '../../interfaces/approval.interface';
import type {
  ApprovalSignature,
  ApprovalSignatureResult,
  ApprovalStore,
  PendingApproval,
} from '../../interfaces/approval.interface';
import { hasSigned, reviveApproval, signatureCount } from '../approval-records';
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
 * Marker the signature that meets an approval's threshold sets, naming its
 * signer, before the approval is deleted. Only that signer can then complete
 * it, so a concurrent caller cannot take the completion over.
 */
const COMPLETING = 'completingSigner';

/**
 * PostgreSQL-backed `ApprovalStore`.
 *
 * Implements atomic, exactly-once claiming using PostgreSQL single-statement `DELETE ... RETURNING`.
 *
 * Dual control (`addSignature`) appends with a single conditional `UPDATE`,
 * which row-locks the approval, so concurrent signatures serialize and a
 * duplicate `userId` or a signature past the threshold is refused. The
 * signature that meets the threshold also marks the record with its signer,
 * then claims it with `DELETE ... RETURNING`, so exactly one caller completes
 * it. If that signer's process stops between the two statements, its next
 * call completes the approval.
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

  async addSignature(id: string, signature: ApprovalSignature): Promise<ApprovalSignatureResult | null> {
    await this.ensureTable();
    const key = this.getKey(id);
    const signer = signature.actor.userId;

    // A refused UPDATE is classified by reading the record, which can change in
    // between; a few attempts settle that race.
    for (let attempt = 0; attempt < 3; attempt++) {
      // Appends the signature unless the signer already signed, the record is
      // at its threshold, or another signer is completing it. The signature
      // that meets the threshold also marks the record as being completed by
      // this signer, so no one else can complete it in the meantime.
      const appended = await this.client.query(
        `UPDATE ${this.tableName}
         SET data = CASE
           WHEN jsonb_array_length(COALESCE(data->'signatures', '[]'::jsonb)) + 1 >= COALESCE((data->>'requiredApprovals')::int, 1)
           THEN jsonb_set(jsonb_set(data, '{signatures}', COALESCE(data->'signatures', '[]'::jsonb) || jsonb_build_array($2::jsonb)), '{${COMPLETING}}', to_jsonb($3::text))
           ELSE jsonb_set(data, '{signatures}', COALESCE(data->'signatures', '[]'::jsonb) || jsonb_build_array($2::jsonb))
         END
         WHERE id = $1
           AND (expires_at IS NULL OR expires_at > NOW())
           AND NOT (data ? '${COMPLETING}')
           AND jsonb_array_length(COALESCE(data->'signatures', '[]'::jsonb)) < COALESCE((data->>'requiredApprovals')::int, 1)
           AND NOT COALESCE(data->'signatures', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('actor', jsonb_build_object('userId', $3::text)))
         RETURNING data`,
        [key, JSON.stringify(signature), signer],
      );

      if (appended.rows.length > 0) {
        const data = safeDeserialize<Record<string, unknown>>(appended.rows[0].data);
        return data[COMPLETING] === signer
          ? this.finishCompletion(key, signer)
          : { status: 'pending', approval: this.deserialize(data)! };
      }

      const current = await this.readRaw(key);
      if (!current) return null;
      if (current[COMPLETING] !== undefined) {
        // This signer's own completion, interrupted between statements, is
        // finished now. Anyone else's is theirs to finish.
        return current[COMPLETING] === signer ? this.finishCompletion(key, signer) : null;
      }
      const approval = this.deserialize(current)!;
      if (signatureCount(approval) >= requiredApprovalsOf(approval)) {
        // At its threshold without a completer, e.g. restored by save(). Take
        // the completion only if no one else has.
        const marked = await this.client.query(
          `UPDATE ${this.tableName}
           SET data = jsonb_set(data, '{${COMPLETING}}', to_jsonb($2::text))
           WHERE id = $1
             AND (expires_at IS NULL OR expires_at > NOW())
             AND NOT (data ? '${COMPLETING}')
             AND jsonb_array_length(COALESCE(data->'signatures', '[]'::jsonb)) >= COALESCE((data->>'requiredApprovals')::int, 1)
           RETURNING data`,
          [key, signer],
        );
        if (marked.rows.length > 0) return this.finishCompletion(key, signer);
        continue;
      }
      if (hasSigned(approval, signer)) {
        return { status: 'duplicate', approval };
      }
    }
    return null;
  }

  /** Claims an approval this signer marked as completing. */
  private async finishCompletion(key: string, signer: string): Promise<ApprovalSignatureResult | null> {
    const result = await this.client.query(
      `DELETE FROM ${this.tableName}
       WHERE id = $1 AND data->>'${COMPLETING}' = $2
       RETURNING data`,
      [key, signer],
    );
    if (result.rows.length === 0) return null;
    return { status: 'complete', approval: this.deserialize(result.rows[0].data)! };
  }

  /** The stored JSON as-is, including the completion marker. */
  private async readRaw(key: string): Promise<Record<string, unknown> | null> {
    const result = await this.client.query(
      `SELECT data FROM ${this.tableName} WHERE id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [key],
    );
    return result.rows.length === 0 ? null : safeDeserialize<Record<string, unknown>>(result.rows[0].data);
  }

  private deserialize(raw: unknown): PendingApproval | null {
    if (!raw) return null;
    const { [COMPLETING]: _completing, ...approval } = safeDeserialize<Record<string, unknown>>(raw);
    return reviveApproval(approval as unknown as PendingApproval);
  }
}
