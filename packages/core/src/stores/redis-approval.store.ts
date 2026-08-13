import { Injectable } from '@nestjs/common';
import type { ApprovalStore, PendingApproval } from '../interfaces/approval.interface';
import type { GenericRedisClient } from './redis-state.store';

export interface RedisApprovalStoreOptions {
  client: GenericRedisClient;
  keyPrefix?: string;
  /**
   * Seconds after which an unresolved approval expires and is no longer
   * returned by `get()`. Unset by default, matching the process-local store,
   * which never expired approvals either.
   */
  ttlSeconds?: number;
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

  constructor(options: RedisApprovalStoreOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'agentic:approval:';
    this.ttlSeconds = options.ttlSeconds;
  }

  private getKey(id: string): string {
    return `${this.keyPrefix}${id}`;
  }

  async save(approval: PendingApproval): Promise<void> {
    const serialized = JSON.stringify(approval);
    const key = this.getKey(approval.id);

    if (this.ttlSeconds) {
      await this.client.set(key, serialized, 'EX', this.ttlSeconds);
    } else {
      await this.client.set(key, serialized);
    }
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
    // Dates do not round-trip through JSON, so createdAt is restored here.
    return { ...parsed, createdAt: new Date(parsed.createdAt) };
  }
}
