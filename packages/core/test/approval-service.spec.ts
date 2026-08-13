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
  } catch (err: any) {
    assert(false, 'Test 1: Approval resumes the model turn', err.message);
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

  console.log(`\n  📊 Step 3 Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Step 3 Unit Tests Failed');
  }
}

// Run directly if executed via node
if (require.main === module) {
  runApprovalServiceTests().catch(() => process.exit(1));
}
