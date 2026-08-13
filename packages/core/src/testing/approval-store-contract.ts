import { APPROVAL_CHECKPOINT_VERSION } from '../interfaces/approval.interface';
import type { ApprovalStore, PendingApproval } from '../interfaces/approval.interface';
import type { AgentContext } from '../interfaces/agent-context.interface';

/** Agent name the harness records on every approval it creates. */
export const CONTRACT_AGENT_NAME = 'contract-agent';

/** Tool name the harness records on every approval it creates. */
export const CONTRACT_TOOL_NAME = 'contractTool';

export interface ApprovalStoreContractOptions {
  /** Store name used in the report. */
  name: string;
  /**
   * Builds an empty store. Called once per assertion group, so each group
   * starts from a clean state and the store may be stateful.
   */
  createStore(): ApprovalStore | Promise<ApprovalStore>;
  /**
   * Set false when the store cannot claim atomically across concurrent callers
   * — for example a Redis client without `GETDEL`, which falls back to a
   * non-atomic get+del. The concurrency assertions are then skipped rather
   * than reported as failures.
   *
   * Default: true
   */
  supportsAtomicClaim?: boolean;
  /** Set false to keep the report quiet. Default: true */
  log?: boolean;
}

export interface ApprovalStoreContractResult {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  failures: string[];
}

/** Number of parallel callers used to probe claim atomicity. */
const CONCURRENT_CLAIMS = 8;

/**
 * Behavioral contract for an `ApprovalStore`.
 *
 * A compliant store persists a `PendingApproval` as data, hands back an
 * equivalent record, and claims it atomically so a human decision is settled at
 * most once. It does not execute tools, evaluate policies, or interpret the
 * approval — `ApprovalService` and `AgentRunner` own that behavior.
 *
 * The contract deliberately treats a record as serializable data rather than a
 * live object: `Date` fields must survive a round trip as `Date`s, nested
 * argument and context values must keep their types, and a record handed back
 * must be isolated from the stored copy. A store that only works because it
 * shares object references in one process would pass a naive test and then fail
 * in production behind Redis.
 *
 * Run this against any store, including third-party implementations, to check
 * it behaves the way the runtime expects.
 *
 * @example
 * const result = await runApprovalStoreContract({
 *   name: 'MyApprovalStore',
 *   createStore: () => new MyApprovalStore({ client: fakeRedis() }),
 * });
 * if (result.failed > 0) throw new Error('Store is not contract compliant');
 */
export async function runApprovalStoreContract(
  options: ApprovalStoreContractOptions,
): Promise<ApprovalStoreContractResult> {
  const supportsAtomicClaim = options.supportsAtomicClaim ?? true;
  const log = options.log ?? true;

  const result: ApprovalStoreContractResult = {
    name: options.name,
    passed: 0,
    failed: 0,
    skipped: 0,
    failures: [],
  };

  function pass(assertion: string) {
    result.passed++;
    if (log) console.log(`  ✅ PASS: ${assertion}`);
  }

  function fail(assertion: string, detail?: string) {
    result.failed++;
    result.failures.push(detail ? `${assertion} (${detail})` : assertion);
    if (log) console.error(`  ❌ FAIL: ${assertion} ${detail ? `(${detail})` : ''}`);
  }

  function check(condition: boolean, assertion: string, detail?: string) {
    if (condition) pass(assertion);
    else fail(assertion, detail);
  }

  function skip(assertion: string) {
    result.skipped++;
    if (log) console.log(`  ⏭️  SKIP: ${assertion}`);
  }

  if (log) {
    console.log(`\n🗄️  ApprovalStore contract: ${options.name}\n`);
  }

  // GROUP 1: a saved approval round-trips as equivalent data
  try {
    const store = await options.createStore();
    const approval = buildApproval({ id: 'apr_roundtrip' });

    await store.save(approval);
    const loaded = await store.get('apr_roundtrip');

    check(loaded !== null, 'get() returns a saved approval');
    check(loaded?.id === approval.id, 'id round-trips');
    check(loaded?.agentName === CONTRACT_AGENT_NAME, 'agentName round-trips');
    check(loaded?.toolName === CONTRACT_TOOL_NAME, 'toolName round-trips');
    check(loaded?.reason === approval.reason, 'reason round-trips');
    check(loaded?.toolCallId === approval.toolCallId, 'toolCallId round-trips');
    check(
      loaded?.createdAt instanceof Date,
      'createdAt round-trips as a Date, not a string',
      `received ${typeof loaded?.createdAt}`,
    );
    check(
      loaded?.createdAt?.getTime() === approval.createdAt.getTime(),
      'createdAt preserves its instant',
    );
    check(
      loaded?.context.sessionId === approval.context.sessionId &&
        loaded?.context.security.tenantId === approval.context.security.tenantId,
      'context round-trips, including security metadata',
    );
    check(
      JSON.stringify(loaded?.args) === JSON.stringify(approval.args),
      'args round-trip with nested values and types intact',
      JSON.stringify(loaded?.args),
    );
  } catch (err) {
    fail('save()/get() round-trips an approval', describe(err));
  }

  // GROUP 2: absent records read as null rather than throwing
  try {
    const store = await options.createStore();

    check((await store.get('apr_missing')) === null, 'get() returns null for an unknown id');
    check((await store.claim('apr_missing')) === null, 'claim() returns null for an unknown id');

    let deleteThrew = false;
    try {
      await store.delete('apr_missing');
    } catch {
      deleteThrew = true;
    }
    check(!deleteThrew, 'delete() of an unknown id resolves instead of throwing');
  } catch (err) {
    fail('store handles absent records', describe(err));
  }

  // GROUP 3: optional fields are preserved, including when unset
  try {
    const store = await options.createStore();
    const expiresAt = new Date(Date.now() + 3_600_000);

    await store.save(buildApproval({ id: 'apr_expiring', expiresAt }));
    const expiring = await store.get('apr_expiring');

    check(
      expiring?.expiresAt instanceof Date,
      'expiresAt round-trips as a Date, not a string',
      `received ${typeof expiring?.expiresAt}`,
    );
    check(
      expiring?.expiresAt?.getTime() === expiresAt.getTime(),
      'expiresAt preserves its instant',
    );

    await store.save(buildApproval({ id: 'apr_no_expiry' }));
    const noExpiry = await store.get('apr_no_expiry');

    check(
      noExpiry?.expiresAt === undefined || noExpiry?.expiresAt === null,
      'an approval saved without expiresAt reads back without one',
      String(noExpiry?.expiresAt),
    );
    check(
      noExpiry?.checkpoint === undefined || noExpiry?.checkpoint === null,
      'an approval saved without a checkpoint reads back without one',
    );
  } catch (err) {
    fail('store preserves optional fields', describe(err));
  }

  // GROUP 4: the resume checkpoint survives storage
  try {
    const store = await options.createStore();
    const approval = buildApproval({ id: 'apr_checkpoint', withCheckpoint: true });

    await store.save(approval);
    const loaded = await store.get('apr_checkpoint');
    const toolMessage = loaded?.checkpoint?.messages.find((m) => m.role === 'tool');

    check(
      loaded?.checkpoint?.version === APPROVAL_CHECKPOINT_VERSION,
      'checkpoint version round-trips',
    );
    check(
      loaded?.checkpoint?.messages.length === approval.checkpoint!.messages.length,
      'checkpoint retains every message',
      `expected ${approval.checkpoint!.messages.length}, got ${loaded?.checkpoint?.messages.length}`,
    );
    check(
      toolMessage?.role === 'tool' && toolMessage.toolCallId === approval.toolCallId,
      'checkpoint retains the withheld tool message and its toolCallId',
    );
    check(
      Boolean(
        loaded?.checkpoint?.messages.some(
          (m) => m.role === 'assistant' && m.toolCalls?.[0]?.name === CONTRACT_TOOL_NAME,
        ),
      ),
      'checkpoint retains the assistant tool-call message',
    );
  } catch (err) {
    fail('store persists the resume checkpoint', describe(err));
  }

  // GROUP 5: a returned record is isolated from the stored copy
  try {
    const store = await options.createStore();
    await store.save(buildApproval({ id: 'apr_isolation', withCheckpoint: true }));

    const first = await store.get('apr_isolation');
    if (first) {
      first.reason = 'mutated by the caller';
      (first.args as Record<string, unknown>).amount = 999_999;
      first.checkpoint?.messages.push({ role: 'user', content: 'injected' });
    }

    const second = await store.get('apr_isolation');

    check(
      second?.reason !== 'mutated by the caller',
      'mutating a returned record does not change the stored one',
    );
    check(
      second?.args.amount !== 999_999,
      'mutating returned args does not change the stored ones',
    );
    check(
      second?.checkpoint?.messages.every((m) => m.content !== 'injected') === true,
      'mutating a returned checkpoint does not change the stored one',
    );
  } catch (err) {
    fail('store isolates returned records', describe(err));
  }

  // GROUP 6: save() replaces an existing record, which is how checkpoints attach
  try {
    const store = await options.createStore();
    await store.save(buildApproval({ id: 'apr_update' }));

    const original = await store.get('apr_update');
    await store.save({
      ...original!,
      checkpoint: {
        version: APPROVAL_CHECKPOINT_VERSION,
        messages: [{ role: 'user', content: 'attached later' }],
      },
    });

    const updated = await store.get('apr_update');

    check(
      updated?.checkpoint?.messages[0]?.content === 'attached later',
      'save() with an existing id replaces the stored record',
    );
    check(updated?.id === 'apr_update', 'the replaced record keeps its id');
  } catch (err) {
    fail('save() updates an existing approval', describe(err));
  }

  // GROUP 7: delete() removes the record
  try {
    const store = await options.createStore();
    await store.save(buildApproval({ id: 'apr_delete' }));
    await store.delete('apr_delete');

    check((await store.get('apr_delete')) === null, 'delete() removes the approval');
  } catch (err) {
    fail('delete() removes an approval', describe(err));
  }

  // GROUP 8: claim() consumes the record, making settlement single-use
  try {
    const store = await options.createStore();
    await store.save(buildApproval({ id: 'apr_claim' }));

    const claimed = await store.claim('apr_claim');

    check(claimed?.id === 'apr_claim', 'claim() returns the approval');
    check(
      claimed?.createdAt instanceof Date,
      'a claimed record is deserialized like a read one',
      `received ${typeof claimed?.createdAt}`,
    );
    check((await store.get('apr_claim')) === null, 'claim() removes the approval');
    check(
      (await store.claim('apr_claim')) === null,
      'claim() is single-use: a second claim returns null',
    );
  } catch (err) {
    fail('claim() consumes an approval', describe(err));
  }

  // GROUP 9: concurrent claims resolve exactly one winner
  if (!supportsAtomicClaim) {
    skip('claim() is atomic under concurrent callers');
  } else {
    try {
      const store = await options.createStore();
      await store.save(buildApproval({ id: 'apr_race' }));

      const claims = await Promise.all(
        Array.from({ length: CONCURRENT_CLAIMS }, () => store.claim('apr_race')),
      );
      const winners = claims.filter((claim) => claim !== null);

      check(
        winners.length === 1,
        'claim() is atomic under concurrent callers: exactly one wins',
        `${winners.length} of ${CONCURRENT_CLAIMS} callers received the record`,
      );
      check(
        winners[0]?.id === 'apr_race',
        'the winning concurrent claim receives the full record',
      );
    } catch (err) {
      fail('claim() is atomic under concurrent callers', describe(err));
    }
  }

  // GROUP 10: records are addressed independently
  try {
    const store = await options.createStore();
    await store.save(buildApproval({ id: 'apr_a' }));
    await store.save(buildApproval({ id: 'apr_b' }));

    await store.claim('apr_a');

    check((await store.get('apr_b')) !== null, 'claiming one approval leaves others intact');
    check((await store.get('apr_a')) === null, 'only the addressed approval is consumed');
  } catch (err) {
    fail('store keeps approvals independent', describe(err));
  }

  if (log) {
    console.log(
      `\n  📊 ${options.name} contract: ${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped.\n`,
    );
  }

  return result;
}

/** Builds a representative approval, exercising nested and typed values. */
function buildApproval(overrides: {
  id: string;
  expiresAt?: Date;
  withCheckpoint?: boolean;
}): PendingApproval {
  const context: AgentContext = {
    sessionId: 'contract_session',
    traceId: 'contract_trace',
    security: {
      userId: 'user_1',
      tenantId: 'tenant_1',
      roles: ['support'],
      permissions: ['refund:write'],
    },
    data: { locale: 'en-US', nested: { flag: true, count: 2 } },
  };

  const approval: PendingApproval = {
    id: overrides.id,
    agentName: CONTRACT_AGENT_NAME,
    toolName: CONTRACT_TOOL_NAME,
    args: {
      amount: 2500,
      currency: 'USD',
      dryRun: false,
      note: null,
      tags: ['high-value', 'manual'],
      metadata: { requestedBy: 'agent', attempt: 1 },
    },
    context,
    reason: 'Amount exceeds the automatic limit.',
    createdAt: new Date('2026-01-15T10:30:00.000Z'),
    toolCallId: 'call_contract_1',
  };

  if (overrides.expiresAt) {
    approval.expiresAt = overrides.expiresAt;
  }

  if (overrides.withCheckpoint) {
    approval.checkpoint = {
      version: APPROVAL_CHECKPOINT_VERSION,
      messages: [
        { role: 'user', content: 'Refund order 42' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'call_contract_1', name: CONTRACT_TOOL_NAME, args: { amount: 2500 } },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'call_contract_1',
          toolName: CONTRACT_TOOL_NAME,
          content: '{"success":false,"status":"pending_approval"}',
        },
      ],
    };
  }

  return approval;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
