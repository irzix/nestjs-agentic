import 'reflect-metadata';
import { ModuleRef } from '@nestjs/core';
import {
  Agent,
  AgentExecutor,
  AgentRunner,
  ApprovalService,
  Context,
  MockModelAdapter,
  Param,
  Tool,
  ToolSet,
  UsePolicies,
} from '../src';
import type {
  AgentConfig,
  AgentContext,
  AgentProvider,
  PolicyResult,
  ToolPolicy,
} from '../src';
import {
  ApprovalCheckpointVersionError,
  ApprovalExpiredError,
  ApprovalNotFoundError,
} from '../src';
import { InMemoryApprovalStore } from '../src/stores/in-memory-approval.store';
import { InMemorySessionStore } from '../src/stores/in-memory-session.store';

class ApprovalNeededPolicy implements ToolPolicy {
  async evaluate(
    _ctx: AgentContext,
    _toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    return Number(args.amount) > 500
      ? { decision: 'require_approval', reason: 'Requires manager approval.' }
      : { decision: 'allow' };
  }
}

@ToolSet({ name: 'ledger' })
class LedgerTools {
  readonly transfers: Array<{ amount: number }> = [];

  @Tool({ name: 'transferMoney', description: 'Transfer funds' })
  @UsePolicies(ApprovalNeededPolicy)
  async transferMoney(
    @Param('amount', { type: 'number', required: true }) amount: number,
    @Context() _ctx: AgentContext,
  ) {
    this.transfers.push({ amount });
    return { txId: 'tx_approved_111', amount };
  }
}

@Agent({ name: 'banker', description: 'Handles transfers' })
class BankerAgent implements AgentProvider {
  constructor(private readonly tools: LedgerTools) {}

  define(): AgentConfig {
    return { instructions: 'Move money carefully.', tools: [this.tools] };
  }
}

class MockModuleRef {
  get(): any {
    return undefined;
  }
}

export async function runApprovalServiceTests() {
  console.log('👥 Running Step 3: ApprovalService (HITL Lifecycle) Unit Tests...\n');

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

  const moduleRef = new MockModuleRef() as unknown as ModuleRef;

  // TEST 1: Approval resumes the suspended turn and the model reacts to it
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Transfer $5000 to vendor')
      .callTool('transferMoney', { amount: 5000 })
      .reply('Transfer of $5000 completed.');

    const { LocalToolProvider, ToolDiscoveryService } = await import('../src');
    const approvalStore = new InMemoryApprovalStore();
    const localToolProvider = new LocalToolProvider(
      [new ApprovalNeededPolicy()],
      approvalStore,
      new ToolDiscoveryService(),
      moduleRef,
    );
    const tools = new LedgerTools();
    const runner = new AgentRunner(
      [new BankerAgent(tools)],
      undefined,
      { defaultModel: { provider: 'mock', model: 'deterministic' } },
      localToolProvider,
      moduleRef,
      new AgentExecutor(model),
      new InMemorySessionStore(),
    );
    const approvals = new ApprovalService(approvalStore, runner);

    const suspended = await runner.run('banker', {
      sessionId: 'sess_hitl_1',
      message: 'Transfer $5000 to vendor',
    });

    const pending = suspended.toolCalls[0]?.result as any;
    assert(pending?.status === 'pending_approval', 'Test 1a: Turn suspended for approval');
    assert(tools.transfers.length === 0, 'Test 1b: Side effect withheld before approval');

    const resumed = (await approvals.approve(pending.approvalId)) as any;
    assert(tools.transfers.length === 1, 'Test 1c: Tool executed exactly once after approval');
    assert(
      resumed.output === 'Transfer of $5000 completed.',
      'Test 1d: Model turn resumed and produced a final answer',
    );
    assert(
      resumed.toolCalls?.[0]?.result?.success === true,
      'Test 1e: Resumed result reflects the approved outcome',
    );

    let secondApproval: unknown;
    try {
      await approvals.approve(pending.approvalId);
    } catch (err) {
      secondApproval = err;
    }
    assert(secondApproval instanceof Error, 'Test 1f: Approval cannot be replayed');
    assert(
      tools.transfers.length === 1,
      'Test 1g: Replayed approval does not re-run the side effect',
    );
  } catch (err: any) {
    assert(false, 'Test 1: Approval resumes the model turn', err.message);
  }

  // TEST 1B: Concurrent approvals of the same id settle exactly once
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Transfer $7000 to vendor')
      .callTool('transferMoney', { amount: 7000 })
      .reply('Transfer of $7000 completed.');

    const { LocalToolProvider, ToolDiscoveryService } = await import('../src');
    const approvalStore = new InMemoryApprovalStore();
    const localToolProvider = new LocalToolProvider(
      [new ApprovalNeededPolicy()],
      approvalStore,
      new ToolDiscoveryService(),
      moduleRef,
    );
    const tools = new LedgerTools();
    const runner = new AgentRunner(
      [new BankerAgent(tools)],
      undefined,
      { defaultModel: { provider: 'mock', model: 'deterministic' } },
      localToolProvider,
      moduleRef,
      new AgentExecutor(model),
      new InMemorySessionStore(),
    );
    const approvals = new ApprovalService(approvalStore, runner);

    const suspended = await runner.run('banker', {
      sessionId: 'sess_hitl_concurrent',
      message: 'Transfer $7000 to vendor',
    });
    const pending = suspended.toolCalls[0]?.result as any;

    // Fire two approvals for the same id at once; exactly one should win.
    const outcomes = await Promise.allSettled([
      approvals.approve(pending.approvalId),
      approvals.approve(pending.approvalId),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    assert(fulfilled.length === 1, 'Test 1B-a: Exactly one concurrent approval succeeds');
    assert(rejected.length === 1, 'Test 1B-b: The losing concurrent approval is rejected');
    assert(
      tools.transfers.length === 1,
      'Test 1B-c: Side effect runs exactly once under concurrency',
    );
  } catch (err: any) {
    assert(false, 'Test 1B: Concurrent approvals settle exactly once', err.message);
  }

  // TEST 2: Rejection resumes the turn with a denied outcome instead of executing
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Transfer $9000 to vendor')
      .callTool('transferMoney', { amount: 9000 })
      .reply('The transfer was not approved.');

    const { LocalToolProvider, ToolDiscoveryService } = await import('../src');
    const approvalStore = new InMemoryApprovalStore();
    const localToolProvider = new LocalToolProvider(
      [new ApprovalNeededPolicy()],
      approvalStore,
      new ToolDiscoveryService(),
      moduleRef,
    );
    const tools = new LedgerTools();
    const runner = new AgentRunner(
      [new BankerAgent(tools)],
      undefined,
      { defaultModel: { provider: 'mock', model: 'deterministic' } },
      localToolProvider,
      moduleRef,
      new AgentExecutor(model),
      new InMemorySessionStore(),
    );
    const approvals = new ApprovalService(approvalStore, runner);

    const suspended = await runner.run('banker', {
      sessionId: 'sess_hitl_2',
      message: 'Transfer $9000 to vendor',
    });

    const pending = suspended.toolCalls[0]?.result as any;
    const resumed = (await approvals.reject(pending.approvalId)) as any;

    assert(tools.transfers.length === 0, 'Test 2a: Rejected transfer never executes');
    assert(
      resumed.output === 'The transfer was not approved.',
      'Test 2b: Model turn resumed with the denial and recovered',
    );

    let secondRejection: unknown;
    try {
      await approvals.reject(pending.approvalId);
    } catch (err) {
      secondRejection = err;
    }
    assert(secondRejection instanceof Error, 'Test 2c: Rejection cannot be replayed');
  } catch (err: any) {
    assert(false, 'Test 2: Rejection resumes with a denial', err.message);
  }

  // TEST 3: Non-existent Approval ID Error Handling
  try {
    const { LocalToolProvider, ToolDiscoveryService } = await import('../src');
    const approvalStore = new InMemoryApprovalStore();
    const localToolProvider = new LocalToolProvider(
      [],
      approvalStore,
      new ToolDiscoveryService(),
      moduleRef,
    );
    const runner = new AgentRunner(
      [new BankerAgent(new LedgerTools())],
      undefined,
      { defaultModel: { provider: 'mock', model: 'deterministic' } },
      localToolProvider,
      moduleRef,
      new AgentExecutor(new MockModelAdapter()),
    );
    const approvals = new ApprovalService(approvalStore, runner);

    let approveThrew = false;
    try {
      await approvals.approve('non_existent_id');
    } catch {
      approveThrew = true;
    }
    assert(approveThrew, 'Test 3a: approve() with unknown ID throws error');

    let rejectThrew = false;
    try {
      await approvals.reject('non_existent_id');
    } catch {
      rejectThrew = true;
    }
    assert(rejectThrew, 'Test 3b: reject() with unknown ID throws error');
  } catch (err: any) {
    assert(false, 'Test 3: Error Handling', err.message);
  }

  // TEST 4: Approval expiry
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Transfer $8000 to vendor')
      .callTool('transferMoney', { amount: 8000 })
      .reply('Transfer of $8000 completed.');

    const { LocalToolProvider, ToolDiscoveryService } = await import('../src');
    const approvalStore = new InMemoryApprovalStore();
    const localToolProvider = new LocalToolProvider(
      [new ApprovalNeededPolicy()],
      approvalStore,
      new ToolDiscoveryService(),
      moduleRef,
    );
    const tools = new LedgerTools();
    const runner = new AgentRunner(
      [new BankerAgent(tools)],
      undefined,
      // Module-level default TTL is threaded through to the pending approval.
      { defaultModel: { provider: 'mock', model: 'deterministic' }, approvalTtlSeconds: 3600 },
      localToolProvider,
      moduleRef,
      new AgentExecutor(model),
      new InMemorySessionStore(),
    );
    const approvals = new ApprovalService(approvalStore, runner);

    const suspended = await runner.run('banker', {
      sessionId: 'sess_hitl_expiry',
      message: 'Transfer $8000 to vendor',
    });
    const pending = suspended.toolCalls[0]?.result as any;

    const stored = await approvalStore.get(pending.approvalId);
    assert(
      stored?.expiresAt instanceof Date,
      'Test 4a: approvalTtlSeconds sets expiresAt on the pending approval',
    );

    // Force the approval past its expiry deterministically instead of waiting.
    await approvalStore.save({ ...stored!, expiresAt: new Date(Date.now() - 1000) });

    let expiredErr: unknown;
    try {
      await approvals.approve(pending.approvalId);
    } catch (err) {
      expiredErr = err;
    }
    assert(
      expiredErr instanceof ApprovalExpiredError,
      'Test 4b: Approving an expired approval throws ApprovalExpiredError',
    );
    assert(tools.transfers.length === 0, 'Test 4c: Expired approval never runs the side effect');

    // The expired approval was claimed (consumed), so it is gone afterwards.
    let secondErr: unknown;
    try {
      await approvals.approve(pending.approvalId);
    } catch (err) {
      secondErr = err;
    }
    assert(
      secondErr instanceof ApprovalNotFoundError,
      'Test 4d: Expired approval is consumed, not left for retry',
    );
  } catch (err: any) {
    assert(false, 'Test 4: Approval expiry', err.message);
  }

  // TEST 5: A policy ttlSeconds still in the future does not block settlement
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Transfer $6000 to vendor')
      .callTool('transferMoney', { amount: 6000 })
      .reply('Transfer of $6000 completed.');

    const { LocalToolProvider, ToolDiscoveryService } = await import('../src');
    const approvalStore = new InMemoryApprovalStore();
    const localToolProvider = new LocalToolProvider(
      [new ApprovalNeededPolicy()],
      approvalStore,
      new ToolDiscoveryService(),
      moduleRef,
    );
    const tools = new LedgerTools();
    const runner = new AgentRunner(
      [new BankerAgent(tools)],
      undefined,
      { defaultModel: { provider: 'mock', model: 'deterministic' }, approvalTtlSeconds: 3600 },
      localToolProvider,
      moduleRef,
      new AgentExecutor(model),
      new InMemorySessionStore(),
    );
    const approvals = new ApprovalService(approvalStore, runner);

    const suspended = await runner.run('banker', {
      sessionId: 'sess_hitl_valid_ttl',
      message: 'Transfer $6000 to vendor',
    });
    const pending = suspended.toolCalls[0]?.result as any;

    const resumed = (await approvals.approve(pending.approvalId)) as any;
    assert(
      tools.transfers.length === 1 && resumed.output === 'Transfer of $6000 completed.',
      'Test 5a: An unexpired approval with a TTL settles normally',
    );
  } catch (err: any) {
    assert(false, 'Test 5: Unexpired TTL settles normally', err.message);
  }

  // TEST 6: A checkpoint on the approval makes resume independent of SessionStore
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Transfer $4000 to vendor')
      .callTool('transferMoney', { amount: 4000 })
      .reply('Transfer of $4000 completed.');

    const { LocalToolProvider, ToolDiscoveryService } = await import('../src');
    const approvalStore = new InMemoryApprovalStore();
    const sessionStore = new InMemorySessionStore();
    const localToolProvider = new LocalToolProvider(
      [new ApprovalNeededPolicy()],
      approvalStore,
      new ToolDiscoveryService(),
      moduleRef,
    );
    const tools = new LedgerTools();
    const runner = new AgentRunner(
      [new BankerAgent(tools)],
      undefined,
      { defaultModel: { provider: 'mock', model: 'deterministic' } },
      localToolProvider,
      moduleRef,
      new AgentExecutor(model),
      sessionStore,
      approvalStore,
    );
    const approvals = new ApprovalService(approvalStore, runner);

    const suspended = await runner.run('banker', {
      sessionId: 'sess_hitl_checkpoint',
      message: 'Transfer $4000 to vendor',
    });
    const pending = suspended.toolCalls[0]?.result as any;

    const stored = await approvalStore.get(pending.approvalId);
    assert(
      stored?.checkpoint?.version === 1,
      'Test 6a: Suspending writes a versioned checkpoint onto the approval',
    );
    assert(
      Boolean(
        stored?.checkpoint?.messages.some(
          (m: any) => m.role === 'tool' && m.toolCallId === stored?.toolCallId,
        ),
      ),
      'Test 6b: Checkpoint contains the withheld tool message',
    );
    assert(
      stored?.checkpoint?.messages.every((m: any) => m.role !== 'system') === true,
      'Test 6c: Checkpoint excludes system messages',
    );

    // Wipe session history entirely: the old implementation resumed from it.
    await sessionStore.delete('sess_hitl_checkpoint');

    const resumed = (await approvals.approve(pending.approvalId)) as any;
    assert(
      tools.transfers.length === 1 && resumed.output === 'Transfer of $4000 completed.',
      'Test 6d: Turn resumes from the checkpoint after session history is cleared',
    );
  } catch (err: any) {
    assert(false, 'Test 6: Checkpoint makes resume transcript-independent', err.message);
  }

  // TEST 7: A checkpoint from an unsupported schema version is refused
  try {
    const { LocalToolProvider, ToolDiscoveryService } = await import('../src');
    const approvalStore = new InMemoryApprovalStore();
    const localToolProvider = new LocalToolProvider(
      [new ApprovalNeededPolicy()],
      approvalStore,
      new ToolDiscoveryService(),
      moduleRef,
    );
    const tools = new LedgerTools();
    const runner = new AgentRunner(
      [new BankerAgent(tools)],
      undefined,
      { defaultModel: { provider: 'mock', model: 'deterministic' } },
      localToolProvider,
      moduleRef,
      new AgentExecutor(new MockModelAdapter()),
      new InMemorySessionStore(),
      approvalStore,
    );
    const approvals = new ApprovalService(approvalStore, runner);

    await approvalStore.save({
      id: 'apr_future_version',
      agentName: 'banker',
      toolName: 'transferMoney',
      args: { amount: 4000 },
      context: { sessionId: 'sess_future', traceId: 't1', security: {} } as any,
      reason: 'Requires manager approval.',
      createdAt: new Date(),
      toolCallId: 'call_1',
      checkpoint: { version: 99, messages: [] },
    });

    let versionErr: unknown;
    try {
      await approvals.approve('apr_future_version');
    } catch (err) {
      versionErr = err;
    }
    assert(
      versionErr instanceof ApprovalCheckpointVersionError,
      'Test 7a: An unsupported checkpoint version throws ApprovalCheckpointVersionError',
    );
  } catch (err: any) {
    assert(false, 'Test 7: Unsupported checkpoint version is refused', err.message);
  }

  // TEST 8: Approval Cancellation Support (AbortSignal)
  try {
    const { ExecutionCancelledError, LocalToolProvider, ToolDiscoveryService } =
      await import('../src');
    const approvalStore = new InMemoryApprovalStore();
    const localToolProvider = new LocalToolProvider(
      [],
      approvalStore,
      new ToolDiscoveryService(),
      moduleRef,
    );
    const runner = new AgentRunner(
      [],
      undefined,
      { defaultModel: { provider: 'mock', model: 'deterministic' } },
      localToolProvider,
      moduleRef,
      new AgentExecutor(new MockModelAdapter()),
      new InMemorySessionStore(),
      approvalStore,
    );
    const approvals = new ApprovalService(approvalStore, runner);

    await approvalStore.save({
      id: 'apr_cancel_test',
      agentName: 'banker',
      toolName: 'transferMoney',
      args: { amount: 100 },
      context: { sessionId: 'sess_cancel', traceId: 't_c', security: {} } as any,
      reason: 'Need approval',
      createdAt: new Date(),
    });

    const controller = new AbortController();
    controller.abort();

    let abortErr: unknown;
    try {
      await approvals.approve('apr_cancel_test', { signal: controller.signal });
    } catch (err) {
      abortErr = err;
    }

    assert(
      abortErr instanceof ExecutionCancelledError,
      'Test 8a: ApprovalService.approve throws ExecutionCancelledError when aborted',
    );

    const untouched = await approvalStore.get('apr_cancel_test');
    assert(
      Boolean(untouched),
      'Test 8b: Aborted approval was not claimed or consumed from store',
    );
  } catch (err: any) {
    assert(false, 'Test 8: Approval Cancellation Support', err.message);
  }

  console.log(`\n  📊 Step 3 Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Step 3 Unit Tests Failed');
  }
}

// Run directly if executed via node
if (require.main === module) {
  runApprovalServiceTests().catch(() => process.exit(1));
}
