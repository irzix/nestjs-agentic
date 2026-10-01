import { Injectable } from '@nestjs/common';
import type {
  ApprovalSignature,
  ApprovalSignatureResult,
  ApprovalStore,
  PendingApproval,
} from '../../interfaces/approval.interface';
import { reviveApproval, reviveSignature } from '../approval-records';
import type { GenericRedisClient } from './redis-state.store';

/** Runs a Lua script server-side, given its keys and arguments. */
export type RedisEvalFn = (script: string, keys: string[], args: (string | number)[]) => Promise<unknown>;

/**
 * Records one signature in a single atomic step, without decoding JSON.
 *
 * The stored value is the approval's JSON on the first line, written with
 * `requiredApprovals` as its first key so the script can read it with an
 * anchored match, then one line per signature: the JSON-encoded signer
 * userId, a tab, and the signature's JSON. JSON never contains a raw tab or
 * newline, so the separators are unambiguous. Avoiding cjson means a record
 * cjson cannot parse (a lone surrogate in a transcript) can still be signed,
 * and a large checkpoint is never decoded inside Redis.
 *
 * KEYS[1] approval key. ARGV[1] JSON-encoded signer userId, ARGV[2] the
 * signature line. Returns nil when absent, else { status, value }.
 */
const ADD_SIGNATURE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
local newline = string.find(raw, '\\n', 1, true)
local head = raw
if newline then head = string.sub(raw, 1, newline - 1) end
local required = tonumber(string.match(head, '^{"requiredApprovals":(%d+)')) or 1
local count = 0
local duplicate = false
if newline then
  for line in string.gmatch(string.sub(raw, newline + 1), '[^\\n]+') do
    count = count + 1
    local tab = string.find(line, '\\t', 1, true)
    if tab and string.sub(line, 1, tab - 1) == ARGV[1] then duplicate = true end
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

/** Atomic read-and-delete for servers or clients without `GETDEL`. */
const CLAIM_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if raw then redis.call('DEL', KEYS[1]) end
return raw
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
  /**
   * Adapter for clients whose `eval` signature differs from the positional
   * ioredis form, such as node-redis v4:
   *
   * ```typescript
   * evalFn: (script, keys, args) => client.eval(script, { keys, arguments: args.map(String) })
   * ```
   *
   * Takes precedence over `client.eval`. Needed for dual control
   * (`addSignature`), and used for an atomic `claim()` when the client has no
   * `getdel`.
   */
  evalFn?: RedisEvalFn;
}

/**
 * Redis-backed `ApprovalStore`.
 *
 * `PendingApproval` is fully serializable (no closures), so a pending
 * approval created on one instance can be resolved on another, and survives
 * a process restart. Resolving it re-resolves the agent, its tools, and the
 * tool method through DI using `agentName` and `toolName`.
 *
 * Dual control (`addSignature`) is available when a script can be run (an
 * `evalFn`, or a client exposing `eval`), since collecting a signature and
 * claiming on the last one must be a single atomic step. Without it the
 * method is absent, and a policy asking for more than one approver is denied
 * rather than downgraded. A dual-control approval and its signatures share
 * one key, so this works on Redis Cluster.
 *
 * Every instance must run a release that understands dual control before a
 * policy asks for more than one approver: an older instance ignores
 * `requiredApprovals`.
 */
@Injectable()
export class RedisApprovalStore implements ApprovalStore {
  private readonly client: GenericRedisClient;
  private readonly keyPrefix: string;
  private readonly ttlSeconds?: number;
  private readonly expiryGraceSeconds: number;
  private readonly evalFn?: RedisEvalFn;

  /**
   * Records one approver's sign-off, claiming the approval on the signature
   * that meets its threshold. Present only when a script can be run.
   */
  readonly addSignature?: (id: string, signature: ApprovalSignature) => Promise<ApprovalSignatureResult | null>;

  constructor(options: RedisApprovalStoreOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'agentic:approval:';
    this.ttlSeconds = options.ttlSeconds;
    this.expiryGraceSeconds = options.expiryGraceSeconds ?? 300;
    const client = this.client;
    this.evalFn =
      options.evalFn ??
      (typeof client.eval === 'function'
        ? (script, keys, args) => client.eval!(script, keys.length, ...keys, ...args)
        : undefined);
    if (this.evalFn) {
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
   * instances. Uses Redis `GETDEL` when the client exposes it, otherwise a
   * GET-and-DEL script when one can be run. Falls back to a non-atomic
   * get+del only when neither is available; concurrent callers on different
   * instances could then both observe the record, so prefer a client that
   * supports `GETDEL` (Redis 6.2+) or `eval` for the exactly-once guarantee.
   */
  async claim(id: string): Promise<PendingApproval | null> {
    const key = this.getKey(id);

    if (typeof this.client.getdel === 'function') {
      return this.deserialize(await this.client.getdel(key));
    }
    if (this.evalFn) {
      const raw = await this.evalFn(CLAIM_SCRIPT, [key], []);
      return this.deserialize(typeof raw === 'string' ? raw : null);
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
    const reply = await this.evalFn!(ADD_SIGNATURE_SCRIPT, [this.getKey(id)], [
      JSON.stringify(signature.actor.userId),
      signatureLine(signature),
    ]);
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
    const approval = reviveApproval(JSON.parse(head) as PendingApproval);
    const signatures = lines
      .filter((line) => line.length > 0)
      .map((line) => reviveSignature(JSON.parse(line.slice(line.indexOf('\t') + 1)) as ApprovalSignature));
    if (signatures.length > 0) {
      approval.signatures = signatures;
    }
    return approval;
  }
}

/**
 * The approval's JSON, then one line per signature. A record that needs one
 * approver serializes exactly as it always has; one that needs more puts
 * `requiredApprovals` first, where the signature script reads it.
 */
function serialize(approval: PendingApproval): string {
  const { signatures, requiredApprovals, ...rest } = approval;
  const head =
    requiredApprovals !== undefined ? JSON.stringify({ requiredApprovals, ...rest }) : JSON.stringify(rest);
  return [head, ...(signatures ?? []).map(signatureLine)].join('\n');
}

function signatureLine(signature: ApprovalSignature): string {
  return `${JSON.stringify(signature.actor.userId)}\t${JSON.stringify(signature)}`;
}
