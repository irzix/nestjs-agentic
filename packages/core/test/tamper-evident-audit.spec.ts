import {
  AUDIT_CHAIN_GENESIS_HASH,
  HashChainAuditSink,
  InMemoryChainedAuditSink,
  PostgresAuditSink,
  canonicalize,
  verifyAuditChain,
} from '../src';
import type { AuditEvent, ChainedAuditEntry } from '../src';

/** Builds a distinct audit event for chain tests. */
function event(approvalId: string, outcome: 'approved' | 'rejected' = 'approved'): AuditEvent {
  return {
    type: 'approval_settled',
    at: new Date('2026-01-01T00:00:00.000Z'),
    sessionId: 'sess_chain',
    traceId: 'trace_chain',
    tenantId: 'acme',
    approvalId,
    agentName: 'banker',
    toolName: 'transferFunds',
    outcome,
    actor: { userId: 'usr_reviewer' },
  };
}

export async function runTamperEvidentAuditTests() {
  console.log('🔗 Running Tamper-Evident Audit Trail Tests (Hash Chain + Postgres Sink)...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // TEST 1: canonical serialization is order-independent and date-stable
  try {
    const a = canonicalize({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalize({ a: { c: 3, d: 2 }, b: 1 });
    assert(a === b, 'Test 1a: key insertion order does not change the canonical form');

    const withDate = canonicalize({ at: new Date('2026-01-01T00:00:00.000Z') });
    assert(withDate.includes('2026-01-01T00:00:00.000Z'), 'Test 1b: Dates serialize as stable ISO strings');

    assert(
      canonicalize({ a: 1, b: undefined }) === canonicalize({ a: 1 }),
      'Test 1c: an undefined property compares equal to an absent one',
    );

    const circular: Record<string, unknown> = { name: 'x' };
    circular.self = circular;
    assert(canonicalize(circular).includes('[Circular]'), 'Test 1d: a cycle is marked instead of overflowing the stack');

    // Distinct content must not collide.
    assert(canonicalize({ a: 1 }) !== canonicalize({ a: 2 }), 'Test 1e: differing content yields a differing canonical form');
  } catch (err: unknown) {
    assert(false, 'Test 1: canonical serialization', String(err));
  }

  // TEST 2: chain is built with genesis, sequence, and linked hashes
  try {
    const store = new InMemoryChainedAuditSink();
    const sink = new HashChainAuditSink(store);

    await sink.record(event('appr_1'));
    await sink.record(event('appr_2'));
    await sink.record(event('appr_3'));

    const entries = store.all();
    assert(entries.length === 3, 'Test 2a: every event is forwarded to the destination');
    assert(entries[0].previousHash === AUDIT_CHAIN_GENESIS_HASH, 'Test 2b: the first entry links to the genesis hash');
    assert(entries[0].sequence === 1 && entries[2].sequence === 3, 'Test 2c: sequence numbers are 1-based and monotonic');
    assert(entries[1].previousHash === entries[0].hash, 'Test 2d: each entry links to its predecessor');
    assert(entries[2].previousHash === entries[1].hash, 'Test 2e: the link holds across the whole chain');
    assert(sink.headHash() === entries[2].hash, 'Test 2f: headHash() exposes the latest hash for anchoring');
    assert(sink.headSequence() === 3, 'Test 2g: headSequence() exposes the latest sequence');
  } catch (err: unknown) {
    assert(false, 'Test 2: chain construction', String(err));
  }

  // TEST 3: an intact chain verifies
  try {
    const store = new InMemoryChainedAuditSink();
    const sink = new HashChainAuditSink(store);
    await sink.record(event('appr_1'));
    await sink.record(event('appr_2'));

    const report = verifyAuditChain(store.all());
    assert(report.valid === true, 'Test 3a: an untampered chain verifies');
    assert(report.verified === 2, 'Test 3b: the verified count matches the entry count');
    assert(report.brokenAt === undefined, 'Test 3c: no break is reported');
  } catch (err: unknown) {
    assert(false, 'Test 3: intact chain verification', String(err));
  }

  // TEST 4: altering a stored event body is detected
  try {
    const store = new InMemoryChainedAuditSink();
    const sink = new HashChainAuditSink(store);
    await sink.record(event('appr_1'));
    await sink.record(event('appr_2', 'rejected'));
    await sink.record(event('appr_3'));

    const entries = store.all();
    // Flip a decision after the fact — exactly the tampering an audit trail must reveal.
    const tampered = entries.map((entry, i) =>
      i === 1
        ? { ...entry, event: { ...entry.event, outcome: 'approved' } as AuditEvent }
        : entry,
    );

    const report = verifyAuditChain(tampered);
    assert(report.valid === false, 'Test 4a: a modified event body breaks verification');
    assert(report.brokenAt === 2, 'Test 4b: the break is reported at the tampered entry');
    assert(String(report.reason).includes('altered'), 'Test 4c: the reason identifies an altered entry');
  } catch (err: unknown) {
    assert(false, 'Test 4: altered event detection', String(err));
  }

  // TEST 5: deleting an entry is detected
  try {
    const store = new InMemoryChainedAuditSink();
    const sink = new HashChainAuditSink(store);
    await sink.record(event('appr_1'));
    await sink.record(event('appr_2'));
    await sink.record(event('appr_3'));

    const entries = store.all();
    const withHole = [entries[0], entries[2]]; // drop sequence 2

    const report = verifyAuditChain(withHole);
    assert(report.valid === false, 'Test 5a: a deleted entry breaks verification');
    assert(report.brokenAt === 3, 'Test 5b: the break is reported at the entry after the hole');
    assert(String(report.reason).includes('deleted or reordered'), 'Test 5c: the reason identifies a missing entry');
  } catch (err: unknown) {
    assert(false, 'Test 5: deleted entry detection', String(err));
  }

  // TEST 6: rewriting a stored hash, or re-linking the chain, is detected
  try {
    const store = new InMemoryChainedAuditSink();
    const sink = new HashChainAuditSink(store);
    await sink.record(event('appr_1'));
    await sink.record(event('appr_2'));

    const entries = store.all();

    const forgedHash = entries.map((entry, i) =>
      i === 0 ? { ...entry, hash: 'f'.repeat(64) } : entry,
    );
    const hashReport = verifyAuditChain(forgedHash);
    assert(hashReport.valid === false, 'Test 6a: rewriting a stored hash breaks verification');
    assert(hashReport.brokenAt === 1, 'Test 6b: the break is reported at the forged entry');

    // Re-link the second entry to the genesis hash, as if the first never existed.
    const reLinked = [{ ...entries[1], previousHash: AUDIT_CHAIN_GENESIS_HASH, sequence: 1 }];
    const linkReport = verifyAuditChain(reLinked);
    assert(linkReport.valid === false, 'Test 6c: re-linking an entry to a different predecessor is detected');
  } catch (err: unknown) {
    assert(false, 'Test 6: forged hash / re-link detection', String(err));
  }

  // TEST 7: a chain can be resumed across restarts
  try {
    const store = new InMemoryChainedAuditSink();
    const first = new HashChainAuditSink(store);
    await first.record(event('appr_1'));
    await first.record(event('appr_2'));

    // Simulate a restart: continue from the persisted head.
    const resumed = new HashChainAuditSink(store, {
      previousHash: first.headHash(),
      startSequence: first.headSequence(),
    });
    await resumed.record(event('appr_3'));

    const entries = store.all();
    assert(entries[2].sequence === 3, 'Test 7a: a resumed chain keeps counting instead of restarting');
    assert(entries[2].previousHash === entries[1].hash, 'Test 7b: the resumed entry links to the persisted head');
    assert(verifyAuditChain(entries).valid === true, 'Test 7c: the combined chain verifies end to end');

    let threw = false;
    try {
      new HashChainAuditSink(store, { startSequence: -1 });
    } catch {
      threw = true;
    }
    assert(threw, 'Test 7d: a negative startSequence is rejected at construction');
  } catch (err: unknown) {
    assert(false, 'Test 7: chain resumption', String(err));
  }

  // TEST 8: concurrent records still produce a verifiable chain
  try {
    const store = new InMemoryChainedAuditSink();
    const sink = new HashChainAuditSink(store);

    // Fired without awaiting individually: the sink must serialize them, since a
    // chain linked out of order would not verify.
    await Promise.all([
      sink.record(event('appr_a')),
      sink.record(event('appr_b')),
      sink.record(event('appr_c')),
      sink.record(event('appr_d')),
    ]);

    const entries = store.all();
    assert(entries.length === 4, 'Test 8a: every concurrent record is chained');
    assert(
      entries.map((e) => e.sequence).join(',') === '1,2,3,4',
      'Test 8b: sequences remain gap-free under concurrency',
    );
    assert(verifyAuditChain(entries).valid === true, 'Test 8c: the chain built under concurrency verifies');
  } catch (err: unknown) {
    assert(false, 'Test 8: concurrent chaining', String(err));
  }

  // TEST 9: a failing destination does not corrupt the chain for later entries
  try {
    const written: ChainedAuditEntry[] = [];
    let failNext = false;
    const flaky = {
      record(entry: ChainedAuditEntry) {
        if (failNext) {
          failNext = false;
          throw new Error('destination unavailable');
        }
        written.push(entry);
      },
    };

    const sink = new HashChainAuditSink(flaky);
    await sink.record(event('appr_1'));

    failNext = true;
    let propagated = false;
    try {
      await sink.record(event('appr_2'));
    } catch {
      propagated = true;
    }
    assert(propagated, 'Test 9a: a destination failure propagates to the caller');

    await sink.record(event('appr_3'));

    assert(written.length === 2, 'Test 9b: only successfully written entries are stored');
    assert(
      written[1].sequence === 2 && written[1].previousHash === written[0].hash,
      'Test 9c: the sequence is not advanced by a failed write, so the stored chain stays gap-free',
    );
    assert(verifyAuditChain(written).valid === true, 'Test 9d: the stored chain still verifies after a failed write');
  } catch (err: unknown) {
    assert(false, 'Test 9: failed destination handling', String(err));
  }

  // TEST 10: PostgresAuditSink persists events and chained entries
  try {
    const queries: { text: string; values?: unknown[] }[] = [];
    const rows: Record<string, unknown>[] = [];

    let nextId = 0;
    const client = {
      async query<R = any>(text: string, values?: unknown[]): Promise<{ rows: R[] }> {
        queries.push({ text, values });

        if (/^\s*CREATE TABLE/i.test(text)) return { rows: [] as R[] };
        if (/^\s*INSERT INTO/i.test(text)) {
          const chainSequence = values?.[0] ?? null;
          // Mirrors the UNIQUE constraint on chain_sequence.
          if (chainSequence !== null && rows.some((r) => r.chain_sequence === chainSequence)) {
            throw Object.assign(new Error('duplicate key value violates unique constraint'), {
              code: '23505',
            });
          }
          nextId += 1;
          rows.push({
            id: nextId,
            chain_sequence: chainSequence,
            type: values?.[1],
            event: values?.[6],
            previous_hash: values?.[7] ?? null,
            hash: values?.[8] ?? null,
          });
          return { rows: [] as R[] };
        }
        if (/ORDER BY chain_sequence DESC/i.test(text)) {
          const chained = rows
            .filter((r) => r.hash != null && r.chain_sequence != null)
            .sort((a, b) => Number(b.chain_sequence) - Number(a.chain_sequence));
          return { rows: (chained[0] ? [chained[0]] : []) as R[] };
        }
        if (/ORDER BY chain_sequence ASC/i.test(text)) {
          return {
            rows: rows
              .filter((r) => r.hash != null && r.chain_sequence != null)
              .sort((a, b) => Number(a.chain_sequence) - Number(b.chain_sequence)) as R[],
          };
        }
        return { rows: [] as R[] };
      },
    };

    const sink = new PostgresAuditSink({ client });

    // Direct AuditSink use: persisted without chain columns.
    await sink.record(event('appr_direct'));
    assert(rows.length === 1, 'Test 10a: a direct audit event is inserted');
    assert(rows[0].hash === null, 'Test 10b: a direct event carries no chain hash');
    assert(rows[0].chain_sequence === null, 'Test 10b2: a direct event claims no chain position');
    assert(
      queries.some((q) => /CREATE TABLE IF NOT EXISTS agentic_audit_events/i.test(q.text)),
      'Test 10c: the audit table is auto-created',
    );
    assert(
      queries.every((q) => !/UPDATE |DELETE /i.test(q.text)),
      'Test 10d: the sink only ever inserts (append-only)',
    );

    // Chained use: the same instance persists hash columns.
    const chained = new HashChainAuditSink(sink);
    await chained.record(event('appr_chained_1'));
    await chained.record(event('appr_chained_2'));

    const chainRows = rows.filter((r) => r.hash);
    assert(chainRows.length === 2, 'Test 10e: chained entries are inserted with hash columns');

    const head = await sink.head();
    assert(head.previousHash === chained.headHash(), 'Test 10f: head() returns the persisted chain head for resumption');
    assert(head.startSequence === chained.headSequence(), 'Test 10g: head() returns the persisted sequence');

    const readBack = await sink.readChain();
    assert(readBack.length === 2, 'Test 10h: readChain() returns stored chained entries');
    assert(
      verifyAuditChain(readBack).valid === true,
      'Test 10i: a chain round-tripped through Postgres still verifies (Date revived correctly)',
    );
  } catch (err: unknown) {
    assert(false, 'Test 10: PostgresAuditSink', String(err));
  }

  // TEST 12: direct and chained writes interleave without colliding, and an
  // unchained write cannot hide the chain from head()/readChain()
  try {
    const rows: Record<string, unknown>[] = [];
    let nextId = 0;
    const client = {
      async query<R = any>(text: string, values?: unknown[]): Promise<{ rows: R[] }> {
        if (/^\s*CREATE TABLE/i.test(text)) return { rows: [] as R[] };
        if (/^\s*INSERT INTO/i.test(text)) {
          const chainSequence = values?.[0] ?? null;
          if (chainSequence !== null && rows.some((r) => r.chain_sequence === chainSequence)) {
            throw Object.assign(new Error('duplicate key'), { code: '23505' });
          }
          nextId += 1;
          rows.push({
            id: nextId,
            chain_sequence: chainSequence,
            event: values?.[6],
            previous_hash: values?.[7] ?? null,
            hash: values?.[8] ?? null,
          });
          return { rows: [] as R[] };
        }
        if (/ORDER BY chain_sequence DESC/i.test(text)) {
          const chained = rows
            .filter((r) => r.hash != null && r.chain_sequence != null)
            .sort((a, b) => Number(b.chain_sequence) - Number(a.chain_sequence));
          return { rows: (chained[0] ? [chained[0]] : []) as R[] };
        }
        if (/ORDER BY chain_sequence ASC/i.test(text)) {
          return {
            rows: rows
              .filter((r) => r.hash != null && r.chain_sequence != null)
              .sort((a, b) => Number(a.chain_sequence) - Number(b.chain_sequence)) as R[],
          };
        }
        return { rows: [] as R[] };
      },
    };

    const sink = new PostgresAuditSink({ client });
    const chained = new HashChainAuditSink(sink);

    // Interleave: direct, chained, direct, chained, direct.
    await sink.record(event('direct_1'));
    await chained.record(event('chained_1'));
    await sink.record(event('direct_2'));
    await chained.record(event('chained_2'));
    await sink.record(event('direct_3'));

    assert(rows.length === 5, 'Test 12a: mixed direct and chained writes all persist without a primary-key collision');

    const readBack = await sink.readChain();
    assert(readBack.length === 2, 'Test 12b: readChain() returns only the chained entries');
    assert(
      readBack.map((e) => e.sequence).join(',') === '1,2',
      'Test 12c: chain sequences stay gap-free despite interleaved unchained rows',
    );
    assert(
      verifyAuditChain(readBack).valid === true,
      'Test 12d: the chain verifies even though unchained rows were written between its entries',
    );

    // The trailing direct write must not make resumption look like an empty chain.
    const head = await sink.head();
    assert(head.previousHash === chained.headHash(), 'Test 12e: head() ignores the later unchained row and returns the chain head');
    assert(head.startSequence === 2, 'Test 12f: head() reports the chain position, not the table row count');
  } catch (err: unknown) {
    assert(false, 'Test 12: mixed direct/chained writes', String(err));
  }

  // TEST 13: a failed table creation is retried instead of being cached
  try {
    let attempts = 0;
    const client = {
      async query<R = any>(text: string): Promise<{ rows: R[] }> {
        if (/^\s*CREATE TABLE/i.test(text)) {
          attempts += 1;
          // A dropped connection carries no Postgres `code`.
          if (attempts === 1) throw new Error('connection terminated unexpectedly');
          return { rows: [] as R[] };
        }
        return { rows: [] as R[] };
      },
    };

    const sink = new PostgresAuditSink({ client });

    let surfaced = false;
    try {
      await sink.record(event('appr_1'));
    } catch {
      surfaced = true;
    }
    assert(surfaced, 'Test 13a: a table-creation error with no Postgres code surfaces instead of being swallowed');

    // The next write must retry the DDL rather than reuse the failed init.
    await sink.record(event('appr_2'));
    assert(attempts === 2, 'Test 13b: a failed initialization is retried on the next write, not cached for the process lifetime');
  } catch (err: unknown) {
    assert(false, 'Test 13: table initialization retry', String(err));
  }

  // TEST 14: a malformed stored row is rejected rather than trusted
  try {
    const client = {
      async query<R = any>(text: string): Promise<{ rows: R[] }> {
        if (/ORDER BY chain_sequence ASC/i.test(text)) {
          return {
            rows: [
              { chain_sequence: 1, event: { type: 'approval_settled' }, previous_hash: 'a', hash: 'b' },
            ] as R[],
          };
        }
        return { rows: [] as R[] };
      },
    };

    const sink = new PostgresAuditSink({ client, autoCreateTable: false });

    let threw = false;
    try {
      await sink.readChain();
    } catch {
      threw = true;
    }
    assert(threw, 'Test 14: a stored row missing required fields is rejected rather than returned as a valid event');
  } catch (err: unknown) {
    assert(false, 'Test 14: stored row validation', String(err));
  }

  // TEST 11: PostgresAuditSink rejects a malicious table name
  try {
    const client = { async query() { return { rows: [] }; } };

    let threw = false;
    try {
      new PostgresAuditSink({ client, tableName: 'audit; DROP TABLE users; --' });
    } catch {
      threw = true;
    }
    assert(threw, 'Test 11: PostgresAuditSink rejects malicious SQL in tableName');
  } catch (err: unknown) {
    assert(false, 'Test 11: table name validation', String(err));
  }

  console.log(`\n  📊 Tamper-Evident Audit Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Tamper-Evident Audit Unit Tests Failed');
  }
}

if (require.main === module) {
  runTamperEvidentAuditTests().catch(() => process.exit(1));
}
