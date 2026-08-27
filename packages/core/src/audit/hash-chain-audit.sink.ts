import { createHash } from 'crypto';

import type { AuditEvent, AuditSink } from '../interfaces/audit.interface';

/** Hash recorded as the predecessor of the first entry in a chain. */
export const AUDIT_CHAIN_GENESIS_HASH = '0'.repeat(64);

/** One audit event bound to its position in a tamper-evident chain. */
export interface ChainedAuditEntry {
  /** 1-based position in the chain. */
  sequence: number;
  /** The event as it was recorded. */
  event: AuditEvent;
  /** Hash of the preceding entry, or `AUDIT_CHAIN_GENESIS_HASH` for the first. */
  previousHash: string;
  /** `H(previousHash || canonical(event))`. */
  hash: string;
}

/** Destination for chained entries, e.g. an append-only table. */
export interface ChainedAuditEntrySink {
  record(entry: ChainedAuditEntry): void | Promise<void>;
}

export interface HashChainAuditSinkOptions {
  /**
   * Hash to continue from, when resuming a chain that already has entries
   * (read the last stored entry's `hash`). Defaults to the genesis hash.
   */
  previousHash?: string;

  /**
   * Sequence number of the entry identified by `previousHash`, so a resumed
   * chain keeps counting instead of restarting at 1. Defaults to `0`.
   */
  startSequence?: number;

  /** Hash algorithm passed to Node's `crypto.createHash`. Default: `'sha256'` */
  algorithm?: string;
}

/**
 * Wraps an audit destination so every event is bound to its predecessor by a
 * hash chain: `hash_n = H(hash_{n-1} || canonical(event_n))`.
 *
 * Altering or deleting a stored entry breaks the chain at that point, which
 * `verifyAuditChain` detects. This makes tampering *evident*; it does not
 * prevent it, and an attacker able to rewrite the entire chain can still
 * produce a self-consistent history. Anchoring — periodically publishing the
 * latest hash somewhere outside the same trust domain — is what closes that gap.
 *
 * Entries are chained in strict arrival order: concurrent `record()` calls are
 * serialized internally, since a chain built out of order would not verify.
 *
 * @example
 * ```typescript
 * const store = new InMemoryChainedAuditSink();
 * const sink = new HashChainAuditSink(store);
 * // ... later
 * const report = verifyAuditChain(store.all());
 * ```
 */
export class HashChainAuditSink implements AuditSink {
  private readonly destination: ChainedAuditEntrySink;
  private readonly algorithm: string;
  private previousHash: string;
  private sequence: number;
  /** Serializes chaining so entries are linked in arrival order. */
  private tail: Promise<void> = Promise.resolve();

  constructor(destination: ChainedAuditEntrySink, options?: HashChainAuditSinkOptions) {
    this.destination = destination;
    this.algorithm = options?.algorithm ?? 'sha256';
    this.previousHash = options?.previousHash ?? AUDIT_CHAIN_GENESIS_HASH;

    const startSequence = options?.startSequence ?? 0;
    if (!Number.isInteger(startSequence) || startSequence < 0) {
      throw new TypeError(
        `HashChainAuditSink: startSequence must be a non-negative integer, received ${String(startSequence)}.`,
      );
    }
    this.sequence = startSequence;
  }

  /** Hash of the most recently chained entry, for anchoring or resuming. */
  headHash(): string {
    return this.previousHash;
  }

  /** Sequence number of the most recently chained entry. */
  headSequence(): number {
    return this.sequence;
  }

  /**
   * Chains the event and forwards it to the destination.
   *
   * @param event The prepared audit event to record.
   */
  record(event: AuditEvent): Promise<void> {
    // Each call links onto the previous one's completion, so `previousHash` is
    // never read concurrently by two in-flight records.
    const chained = this.tail.then(async () => {
      const sequence = this.sequence + 1;
      const previousHash = this.previousHash;
      const hash = computeEntryHash(previousHash, event, this.algorithm);

      await this.destination.record({ sequence, event, previousHash, hash });

      // Advanced only after a successful write, so a failed destination does not
      // leave a gap that would make every later entry fail verification.
      this.sequence = sequence;
      this.previousHash = hash;
    });

    // The tail must not become a rejected promise, or every subsequent record
    // would reject too. Errors still propagate to this call's caller.
    this.tail = chained.catch(() => undefined);
    return chained;
  }
}

/** Collects chained entries in process. Intended for tests and local inspection. */
export class InMemoryChainedAuditSink implements ChainedAuditEntrySink {
  private readonly entries: ChainedAuditEntry[] = [];

  record(entry: ChainedAuditEntry): void {
    this.entries.push(entry);
  }

  /** Every chained entry, oldest first. */
  all(): ChainedAuditEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
  }
}

/** Outcome of verifying a stored chain. */
export interface AuditChainVerification {
  valid: boolean;
  /** Sequence number of the first entry that failed, when invalid. */
  brokenAt?: number;
  /** What specifically failed. */
  reason?: string;
  /** Number of entries checked. */
  verified: number;
}

/**
 * Recomputes a chain and reports the first entry that does not match.
 *
 * Detects a modified event body, a modified stored hash, a re-linked
 * `previousHash`, and a deleted or reordered entry (via the sequence gap).
 *
 * @param entries Stored entries in ascending sequence order.
 * @param options Optional expected starting point, for verifying a chain segment.
 * @returns Whether the chain is intact, and where it first breaks if not.
 */
export function verifyAuditChain(
  entries: readonly ChainedAuditEntry[],
  options?: { previousHash?: string; startSequence?: number; algorithm?: string },
): AuditChainVerification {
  const algorithm = options?.algorithm ?? 'sha256';
  let expectedPrevious = options?.previousHash ?? AUDIT_CHAIN_GENESIS_HASH;
  let expectedSequence = (options?.startSequence ?? 0) + 1;
  let verified = 0;

  for (const entry of entries) {
    if (entry.sequence !== expectedSequence) {
      return {
        valid: false,
        brokenAt: entry.sequence,
        reason: `sequence gap: expected ${expectedSequence}, found ${entry.sequence} (an entry was deleted or reordered)`,
        verified,
      };
    }

    if (entry.previousHash !== expectedPrevious) {
      return {
        valid: false,
        brokenAt: entry.sequence,
        reason: 'previousHash does not match the preceding entry (the chain was re-linked)',
        verified,
      };
    }

    const recomputed = computeEntryHash(entry.previousHash, entry.event, algorithm);
    if (recomputed !== entry.hash) {
      return {
        valid: false,
        brokenAt: entry.sequence,
        reason: 'hash does not match the recorded event (the entry was altered)',
        verified,
      };
    }

    expectedPrevious = entry.hash;
    expectedSequence += 1;
    verified += 1;
  }

  return { valid: true, verified };
}

/** Computes one link: `H(previousHash || canonical(event))`. */
function computeEntryHash(previousHash: string, event: AuditEvent, algorithm: string): string {
  return createHash(algorithm)
    .update(previousHash)
    .update('\u0000')
    .update(canonicalize(event))
    .digest('hex');
}

/**
 * Serializes a value so equal content always produces an identical string.
 *
 * `JSON.stringify` is not sufficient: object key order follows insertion order,
 * so two events with identical content could hash differently. Keys are sorted,
 * `Date`s become ISO strings, and `undefined` properties are dropped so they
 * compare equal to absent ones.
 *
 * Exported for tests and for destinations that need to store the exact bytes
 * that were hashed.
 */
export function canonicalize(value: unknown): string {
  return serialize(value, new WeakSet<object>());
}

function serialize(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return 'null';

  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'undefined') return 'null';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());

  if (typeof value !== 'object') {
    // Functions and symbols carry no auditable content.
    return 'null';
  }

  if (seen.has(value)) {
    // A cycle cannot be canonically serialized; mark it rather than recursing.
    return '"[Circular]"';
  }
  seen.add(value);

  try {
    if (value instanceof Date) {
      return JSON.stringify(Number.isNaN(value.getTime()) ? null : value.toISOString());
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => serialize(item, seen)).join(',')}]`;
    }

    if (value instanceof Map) {
      const pairs = [...value.entries()]
        .map(([k, v]) => [serialize(k, seen), serialize(v, seen)] as const)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return `{${pairs.map(([k, v]) => `${k}:${v}`).join(',')}}`;
    }

    if (value instanceof Set) {
      const members = [...value].map((member) => serialize(member, seen)).sort();
      return `[${members.join(',')}]`;
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();

    return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key], seen)}`).join(',')}}`;
  } finally {
    // Released so the same object appearing twice in sibling positions (not a
    // cycle) still serializes fully.
    seen.delete(value);
  }
}
