import { Injectable } from '@nestjs/common';
import type {
  ApprovalSignature,
  ApprovalSignatureResult,
  ApprovalStore,
  PendingApproval,
} from '../../interfaces/approval.interface';
import { reviveApproval, reviveSignature } from '../approval-records';
import type { GenericRedisClient } from './redis-state.store';

/**
 * Records one signature in a single atomic step. The value is the approval's
 * JSON on the first line and one signature's JSON per following line, so the
 * script appends without re-encoding the approval (cjson would turn empty
 * arrays into objects and round large numbers).
 *
 * KEYS[1] approval key. ARGV[1] signer userId, ARGV[2] signature JSON.
 * Returns nil when absent, else { status, value }.
 */
const ADD_SIGNATURE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
local newline = string.find(raw, '\\n', 1, true)
local head = raw
if newline then head = string.sub(raw, 1, newline - 1) end
local ok, approval = pcall(cjson.decode, head)
if not ok or type(approval) ~= 'table' then
  return redis.error_reply('approval record is not valid JSON')
end
local required = tonumber(approval['requiredApprovals']) or 1
local count = 0
local duplicate = false
if newline then
  for line in string.gmatch(string.sub(raw, newline + 1), '[^\\n]+') do
    count = count + 1
    local okSig, sig = pcall(cjson.decode, line)
    if okSig and type(sig) == 'table' and type(sig['actor']) == 'table' and sig['actor']['userId'] == ARGV[1] then
      duplicate = true
    end
  end
end
if count >= required then
  redis.call('DEL', KEYS[1])
  return { 'complete', raw }
end
if duplicate then
  return { 'duplicate', raw }
end
local updated = raw .. '\\n' .. ARGV[2]
if count + 1 >= required then
  redis.call('DEL', KEYS[1])
  return { 'complete', updated }
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl > 0 then
  redis.call('SET', KEYS[1], updated, 'PX', ttl)
else
  redis.call('SET', KEYS[1], updated)
end
return { 'pending', updated }
`;

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
 *
 * Dual control (`addSignature`) is available when the client exposes `eval`,
 * since collecting a signature and claiming on the last one must be a single
 * atomic step. Without `eval` the method is absent, and a policy asking for
 * more than one approver is denied rather than downgraded. A dual-control
 * approval and its signatures share one key, so this works on Redis Cluster.
 */
@Injectable()
export class RedisApprovalStore implements ApprovalStore {
  private readonly client: GenericRedisClient;
  private readonly keyPrefix: string;
  private readonly ttlSeconds?: number;
  private readonly expiryGraceSeconds: number;

  /**
   * Records one approver's sign-off, claiming the approval on the signature
   * that meets its threshold. Present only when the client exposes `eval`.
   */
  readonly addSignature?: (id: string, signature: ApprovalSignature) => Promise<ApprovalSignatureResult | null>;

  constructor(options: RedisApprovalStoreOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'agentic:approval:';
    this.ttlSeconds = options.ttlSeconds;
    this.expiryGraceSeconds = options.expiryGraceSeconds ?? 300;
    if (typeof this.client.eval === 'function') {
      this.addSignature = (id, signature) => this.addSignatureAtomically(id, signature);
    }
  }

  private getKey(id: string): string {
    return `${this.keyPrefix}${id}`;
  }

  async save(approval: PendingApproval): Promise<void> {
    const serialized = serialize(approval);
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

  private async addSignatureAtomically(
    id: string,
    signature: ApprovalSignature,
  ): Promise<ApprovalSignatureResult | null> {
    const reply = await this.client.eval!(
      ADD_SIGNATURE_SCRIPT,
      1,
      this.getKey(id),
      signature.actor.userId,
      JSON.stringify(signature),
    );
    if (reply === null || reply === undefined) return null;
    if (!Array.isArray(reply) || reply.length !== 2) {
      throw new Error(`Unexpected reply from the addSignature script: ${JSON.stringify(reply)}`);
    }
    const [status, raw] = reply as [unknown, unknown];
    const approval = typeof raw === 'string' ? this.deserialize(raw) : null;
    if ((status !== 'pending' && status !== 'complete' && status !== 'duplicate') || !approval) {
      throw new Error(`Unexpected reply from the addSignature script: ${JSON.stringify(reply)}`);
    }
    return { status, approval };
  }

  private deserialize(raw: string | null): PendingApproval | null {
    if (!raw) return null;

    // The first line is the approval; any further lines are dual-control
    // signatures, oldest first. Dates do not round-trip through JSON, so they
    // are restored here.
    const [head, ...lines] = raw.split('\n');
    const parsed = JSON.parse(head) as PendingApproval;
    const signatures = lines
      .filter((line) => line.length > 0)
      .map((line) => reviveSignature(JSON.parse(line) as ApprovalSignature));
    const approval = reviveApproval(parsed);
    if (signatures.length > 0) {
      approval.signatures = signatures;
    }
    return approval;
  }
}

/**
 * The approval's JSON, followed by one line per signature. A record without
 * signatures serializes exactly as it always has.
 */
function serialize(approval: PendingApproval): string {
  const { signatures, ...rest } = approval;
  return [JSON.stringify(rest), ...(signatures ?? []).map((signature) => JSON.stringify(signature))].join('\n');
}
