import { Injectable } from '@nestjs/common';
import type { ApprovalStore, PendingApproval } from '../interfaces/approval.interface';
import type { GenericRedisClient } from './redis-state.store';

export interface RedisApprovalStoreOptions {
  client: GenericRedisClient;
  keyPrefix?: string;
  /**
   * Fallback key lifetime, in seconds, for approvals that carry no `expiresAt`
   * of their own. Approvals created with a TTL (via a policy's `ttlSeconds` or
   * the module's `approvalTtlSeconds`) derive their key lifetime from
   * `expiresAt` instead and ignore this value. Unset means such approvals
   * never expire in Redis.
   */
  ttlSeconds?: number;
  /**
   * Extra seconds to keep an approval in Redis past its `expiresAt` before the
   * key is garbage-collected. The grace window lets a just-expired approval
   * still be claimed so callers receive a precise `ApprovalExpiredError`
   * rather than a generic `ApprovalNotFoundError`. Defaults to 300 (5 minutes).
   */
  expiryGraceSeconds?: number;
}

/**
 * Redis-backed `ApprovalStore`.
 *
 * `PendingApproval` is fully serializable (no closures), so a pending
 * approval created on one instance can be resolved on another, and survives
 * a process restart. Resolving it re-resolves the agent, its tools, and the
 * tool method through DI using `agentName` and `toolName`.
 */
@Injectable()
export class RedisApprovalStore implements ApprovalStore {
  private readonly client: GenericRedisClient;
  private readonly keyPrefix: string;
  private readonly ttlSeconds?: number;
  private readonly expiryGraceSeconds: number;

  constructor(options: RedisApprovalStoreOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'agentic:approval:';
    this.ttlSeconds = options.ttlSeconds;
    this.expiryGraceSeconds = options.expiryGraceSeconds ?? 300;
  }

  private getKey(id: string): string {
    return `${this.keyPrefix}${id}`;
  }

  async save(approval: PendingApproval): Promise<void> {
    const serialized = JSON.stringify(approval);
    const key = this.getKey(approval.id);
    const ttl = this.resolveTtlSeconds(approval);

    if (ttl !== undefined) {
      await this.client.set(key, serialized, 'EX', ttl);
    } else {
      await this.client.set(key, serialized);
    }
  }

  /**
   * Key lifetime in seconds, or undefined for no expiry. An approval's own
   * `expiresAt` wins and is extended by the grace window so the domain-level
   * expiry check (in `ApprovalService`) can still observe and report it before
   * Redis reclaims the key. Approvals without `expiresAt` fall back to the
   * configured `ttlSeconds`.
   */
  private resolveTtlSeconds(approval: PendingApproval): number | undefined {
    if (approval.expiresAt) {
      const msUntilExpiry = new Date(approval.expiresAt).getTime() - Date.now();
      const seconds = Math.ceil(msUntilExpiry / 1000) + this.expiryGraceSeconds;
      // Guard against a non-positive TTL, which Redis would reject; keep the
      // key alive for at least the grace window so the expiry is observable.
      return Math.max(seconds, this.expiryGraceSeconds, 1);
    }

    return this.ttlSeconds;
  }

  async get(id: string): Promise<PendingApproval | null> {
    const raw = await this.client.get(this.getKey(id));
    return this.deserialize(raw);
  }

  async delete(id: string): Promise<void> {
    await this.client.del(this.getKey(id));
  }

  /**
   * Atomically claims the approval so it can be settled at most once across
   * instances. Uses Redis `GETDEL` when the client exposes it, which reads
   * and removes the key in a single round trip. Falls back to a non-atomic
   * get+del when `getdel` is unavailable; in that case concurrent callers on
   * different instances could both observe the record, so prefer a client
   * that supports `GETDEL` (Redis 6.2+) for the exactly-once guarantee.
   */
  async claim(id: string): Promise<PendingApproval | null> {
    const key = this.getKey(id);

    if (typeof this.client.getdel === 'function') {
      return this.deserialize(await this.client.getdel(key));
    }

    const raw = await this.client.get(key);
    if (!raw) return null;
    await this.client.del(key);
    return this.deserialize(raw);
  }

  private deserialize(raw: string | null): PendingApproval | null {
    if (!raw) return null;

    const parsed = JSON.parse(raw) as PendingApproval;
    // Dates do not round-trip through JSON, so they are restored here.
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : undefined,
    };
  }
}
