import 'reflect-metadata';
import {
  GenericPostgresClient,
  PostgresApprovalStore,
  PostgresIdempotencyStore,
  PostgresSessionStore,
  PostgresStateStore,
  runApprovalStoreContract,
  runIdempotencyStoreContract,
  runSessionStoreContract,
} from '../src';

interface StoredRow {
  [column: string]: any;
}

/**
 * In-process mock PostgreSQL client simulating SQL table queries,
 * upserts (`ON CONFLICT DO UPDATE`), `DELETE ... RETURNING`, and TTL filtering.
 */
export function createFakePostgres() {
  const tables = new Map<string, Map<string, StoredRow>>();
  const queries: { sql: string; values?: any[] }[] = [];

  function getTable(name: string): Map<string, StoredRow> {
    if (!tables.has(name)) {
      tables.set(name, new Map());
    }
    return tables.get(name)!;
  }

  const client: GenericPostgresClient = {
    async query<R = any>(queryText: string, values: any[] = []): Promise<{ rows: R[]; rowCount?: number }> {
      queries.push({ sql: queryText, values });
      const normalized = queryText.trim().replace(/\s+/g, ' ');

      // CREATE TABLE
      if (normalized.startsWith('CREATE TABLE')) {
        const match = normalized.match(/CREATE TABLE IF NOT EXISTS ([a-zA-Z0-9_]+)/i);
        if (match) {
          getTable(match[1]);
        }
        return { rows: [], rowCount: 0 };
      }

      // CREATE INDEX
      if (normalized.startsWith('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }

      // INSERT / UPSERT
      if (normalized.startsWith('INSERT INTO')) {
        const intoMatch = normalized.match(/INSERT INTO ([a-zA-Z0-9_]+)\s*\(([^)]+)\)/i);
        if (intoMatch) {
          const tableName = intoMatch[1];
          const cols = intoMatch[2].split(',').map((c) => c.trim());
          const table = getTable(tableName);
          const row: StoredRow = {};

          const valuesIndex = normalized.indexOf('VALUES');
          const onConflictIndex = normalized.indexOf('ON CONFLICT');
          const valClause = (
            onConflictIndex !== -1
              ? normalized.substring(valuesIndex + 6, onConflictIndex)
              : normalized.substring(valuesIndex + 6)
          ).trim();
          // Remove outer ( and )
          const innerValClause = valClause.replace(/^\(/, '').replace(/\)$/, '');
          // Split by comma ignoring ::jsonb
          const valExprs = innerValClause.split(',').map((v) => v.trim());

          cols.forEach((col, idx) => {
            const expr = valExprs[idx] || '';
            const dollarMatch = expr.match(/\$(\d+)/);
            if (dollarMatch) {
              const paramIdx = parseInt(dollarMatch[1], 10) - 1;
              row[col] = values[paramIdx];
            } else if (expr.toUpperCase() === 'NOW()') {
              row[col] = new Date();
            } else {
              row[col] = values[idx];
            }
          });

          const pk = values[0];
          table.set(pk, row);
          return { rows: [], rowCount: 1 };
        }
      }

      // SELECT
      if (normalized.startsWith('SELECT')) {
        const match = normalized.match(/FROM ([a-zA-Z0-9_]+) WHERE ([^;]+)/i);
        if (match) {
          const tableName = match[1];
          const table = getTable(tableName);
          const key = values[0];
          const row = table.get(key);

          if (!row) {
            return { rows: [], rowCount: 0 };
          }

          // Check expires_at
          if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
            return { rows: [], rowCount: 0 };
          }

          return { rows: [row as R], rowCount: 1 };
        }
      }

      // DELETE ... RETURNING
      if (normalized.startsWith('DELETE FROM') && normalized.includes('RETURNING')) {
        const match = normalized.match(/DELETE FROM ([a-zA-Z0-9_]+) WHERE/i);
        if (match) {
          const tableName = match[1];
          const table = getTable(tableName);
          const key = values[0];
          const row = table.get(key);

          if (!row) {
            return { rows: [], rowCount: 0 };
          }

          if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
            table.delete(key);
            return { rows: [], rowCount: 0 };
          }

          table.delete(key);
          return { rows: [row as R], rowCount: 1 };
        }
      }

      // DELETE
      if (normalized.startsWith('DELETE FROM')) {
        const match = normalized.match(/DELETE FROM ([a-zA-Z0-9_]+) WHERE ([^;]+)/i);
        if (match) {
          const tableName = match[1];
          const table = getTable(tableName);

          if (normalized.includes('LIKE')) {
            const pattern = String(values[0]).replace(/%/g, '.*');
            const regex = new RegExp(`^${pattern}$`);
            let count = 0;
            for (const [k] of Array.from(table.entries())) {
              if (regex.test(k)) {
                table.delete(k);
                count++;
              }
            }
            return { rows: [], rowCount: count };
          }

          const key = values[0];
          const deleted = table.delete(key);
          return { rows: [], rowCount: deleted ? 1 : 0 };
        }
      }

      return { rows: [], rowCount: 0 };
    },
  };

  return { client, tables, queries };
}

export async function runPostgresStoresTests() {
  console.log('🐘 Running PostgreSQL Persistence Stores Contract & Feature Tests...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string, detail?: string) {
    if (condition) {
      passed++;
      console.log(`  ✅ PASS: ${name}`);
    } else {
      failed++;
      console.error(`  ❌ FAIL: ${name} ${detail ? `(${detail})` : ''}`);
    }
  }

  // 1. PostgresSessionStore Contract
  {
    const { client } = createFakePostgres();
    const result = await runSessionStoreContract({
      name: 'PostgresSessionStore',
      createStore: () => new PostgresSessionStore({ client }),
      log: false,
    });
    assert(result.failed === 0, 'Test 1: PostgresSessionStore passes SessionStore contract');
  }

  // 2. PostgresApprovalStore Contract
  {
    const { client } = createFakePostgres();
    const result = await runApprovalStoreContract({
      name: 'PostgresApprovalStore',
      createStore: () => new PostgresApprovalStore({ client }),
      log: false,
    });
    assert(result.failed === 0, 'Test 2: PostgresApprovalStore passes ApprovalStore contract');
  }

  // 3. PostgresIdempotencyStore Contract
  {
    const { client } = createFakePostgres();
    const result = await runIdempotencyStoreContract({
      name: 'PostgresIdempotencyStore',
      createStore: () => new PostgresIdempotencyStore({ client }),
      log: false,
    });
    assert(result.failed === 0, 'Test 3: PostgresIdempotencyStore passes IdempotencyStore contract');
  }

  // 4. PostgresStateStore Feature Tests
  try {
    const { client, tables } = createFakePostgres();
    const store = new PostgresStateStore({ client, keyPrefix: 'test:state:' });

    // Set value with TTL
    await store.set('key1', { count: 42, name: 'State Test' }, 60);

    const loaded = await store.get<{ count: number; name: string }>('key1');
    assert(loaded?.count === 42, 'Test 4a: PostgresStateStore retrieves saved JSON state');
    assert(loaded?.name === 'State Test', 'Test 4b: PostgresStateStore field matches');

    // Overwrite
    await store.set('key1', { count: 99, name: 'Updated' });
    const updated = await store.get<{ count: number }>('key1');
    assert(updated?.count === 99, 'Test 4c: PostgresStateStore overwrites existing key');

    // Clear with prefix
    await store.set('order:1', { orderId: 1 });
    await store.set('order:2', { orderId: 2 });
    await store.clear('order:');
    const cleared = await store.get('order:1');
    assert(cleared === null, 'Test 4d: PostgresStateStore clear with prefix removes matching rows');

    // Delete single key
    await store.delete('key1');
    const afterDelete = await store.get('key1');
    assert(afterDelete === null, 'Test 4e: PostgresStateStore delete removes item');
  } catch (err: any) {
    assert(false, 'Test 4: PostgresStateStore features', err.message);
  }

  // 5. PostgresApprovalStore Atomic Claim (DELETE ... RETURNING)
  try {
    const { client } = createFakePostgres();
    const store = new PostgresApprovalStore({ client });

    const approval = {
      id: 'app_claim_1',
      agentName: 'support',
      toolName: 'refund',
      args: { amount: 500 },
      context: { sessionId: 'sess_claim', traceId: 'tr_claim', security: {} },
      reason: 'Over limit',
      createdAt: new Date(),
    };

    await store.save(approval);

    // First claim gets the approval
    const claimed1 = await store.claim('app_claim_1');
    assert(claimed1 !== null, 'Test 5a: First claim succeeds and retrieves approval');
    assert(claimed1?.id === 'app_claim_1', 'Test 5b: Claimed approval id matches');

    // Second claim gets null (atomic exactly-once)
    const claimed2 = await store.claim('app_claim_1');
    assert(claimed2 === null, 'Test 5c: Concurrent/second claim returns null');
  } catch (err: any) {
    assert(false, 'Test 5: Atomic Claiming', err.message);
  }

  // 6. PostgresSessionStore with Custom Table and Prefix
  try {
    const { client, tables } = createFakePostgres();
    const store = new PostgresSessionStore({
      client,
      tableName: 'custom_sessions_tbl',
      keyPrefix: 'tenant_custom:',
      ttlSeconds: 1800,
    });

    await store.set('sess_999', { sessionId: 'sess_999', messages: [] });

    assert(tables.has('custom_sessions_tbl'), 'Test 6a: Custom session table created');
    const row = tables.get('custom_sessions_tbl')!.get('tenant_custom:sess_999');
    assert(Boolean(row), 'Test 6b: Row saved with custom prefix');
    assert(
      row?.expires_at instanceof Date,
      'Test 6c: Session TTL computed and saved as Date',
      `expires_at was: ${row?.expires_at} (keys: ${JSON.stringify(Object.keys(row || {}))})`,
    );
  } catch (err: any) {
    assert(false, 'Test 6: Custom table and prefix', err.message);
  }

  // 7. PostgresIdempotencyStore with Fallback TTL
  try {
    const { client, tables } = createFakePostgres();
    const store = new PostgresIdempotencyStore({
      client,
      tableName: 'custom_idem_tbl',
      ttlSeconds: 600,
    });

    await store.save({
      key: 'idem_no_expiry',
      toolName: 'executeAction',
      result: { success: true, data: 'done' },
      createdAt: new Date(),
    });

    const row = tables.get('custom_idem_tbl')!.get('agentic:idempotency:idem_no_expiry');
    assert(Boolean(row), 'Test 7a: Idempotency record saved');
    assert(row?.expires_at instanceof Date, 'Test 7b: Fallback TTL applied to expires_at');
  } catch (err: any) {
    assert(false, 'Test 7: Idempotency TTL', err.message);
  }

  // 8. PostgresStateStore with autoCreateTable disabled
  try {
    const { client, queries } = createFakePostgres();
    const store = new PostgresStateStore({
      client,
      autoCreateTable: false,
    });

    await store.set('k1', 'v1');
    const hasCreateTable = queries.some((q) => q.sql.includes('CREATE TABLE'));
    assert(!hasCreateTable, 'Test 8: autoCreateTable=false skips CREATE TABLE queries');
  } catch (err: any) {
    assert(false, 'Test 8: autoCreateTable disabled', err.message);
  }

  console.log(`\n  📊 PostgreSQL Stores Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('PostgreSQL Stores Tests Failed');
  }
}

if (require.main === module) {
  runPostgresStoresTests().catch(() => process.exit(1));
}
