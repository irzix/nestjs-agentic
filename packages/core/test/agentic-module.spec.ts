import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  Agent,
  AgentExecutor,
  AgenticModule,
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
import { Global, Injectable, Module } from '@nestjs/common';

@Injectable()
class TransferPolicy implements ToolPolicy {
  async evaluate(
    _ctx: AgentContext,
    _toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    return Number(args.amount) > 1000
      ? { decision: 'require_approval', reason: 'Transfer exceeds $1000.' }
      : { decision: 'allow' };
  }
}

@Injectable()
class LedgerService {
  readonly transfers: Array<{ amount: number; tenantId?: string }> = [];

  record(amount: number, tenantId?: string) {
    this.transfers.push({ amount, tenantId });
    return { recorded: true, amount };
  }
}

/**
 * AgenticModule.forFeature() registers tool sets inside the AgenticModule
 * context, so their dependencies must be globally available. This mirrors the
 * pattern used by the runnable examples.
 */
@Global()
@Module({ providers: [LedgerService], exports: [LedgerService] })
class LedgerModule {}

@ToolSet({ name: 'banking' })
class BankingTools {
  constructor(private readonly ledger: LedgerService) {}

  @Tool({ name: 'transfer', description: 'Transfer funds' })
  @UsePolicies(TransferPolicy)
  async transfer(
    @Param('amount', { type: 'number', required: true }) amount: number,
    @Context() ctx: AgentContext,
  ) {
    return this.ledger.record(amount, ctx.security.tenantId);
  }
}

@Agent({ name: 'banker', description: 'Handles transfers' })
class BankerAgent implements AgentProvider {
  constructor(private readonly tools: BankingTools) {}

  define(): AgentConfig {
    return { instructions: 'Move money carefully.', tools: [this.tools] };
  }
}

export async function runAgenticModuleTests() {
  console.log('🧩 Running Step 8: AgenticModule DI Integration Tests...\n');

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

  async function bootstrap(model: MockModelAdapter) {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LedgerModule,
        AgenticModule.forRoot({
          defaultModel: { provider: 'mock', model: 'deterministic' },
          modelAdapter: model,
          limits: { maxIterations: 4 },
        }),
        AgenticModule.forFeature({
          agents: [BankerAgent],
          toolSets: [BankingTools],
          policies: [TransferPolicy],
        }),
      ],
    }).compile();

    return moduleRef;
  }

  // TEST 1: Built-in runtime resolves through Nest DI without a RuntimeAdapter
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Send $250 to payroll')
      .callTool('transfer', { amount: 250 })
      .reply('Transfer of $250 completed.');

    const moduleRef = await bootstrap(model);
    const runner = moduleRef.get(AgentRunner, { strict: false });
    const ledger = moduleRef.get(LedgerService, { strict: false });
    const executor = moduleRef.get(AgentExecutor, { strict: false });

    assert(executor.isAvailable(), 'Test 1a: AgentExecutor resolves the registered ModelAdapter');

    const result = await runner.run('banker', {
      sessionId: 'sess_di_1',
      message: 'Send $250 to payroll',
      context: { tenantId: 'acme' },
    });

    assert(ledger.transfers.length === 1, 'Test 1b: Injected application service executed');
    assert(
      ledger.transfers[0]?.tenantId === 'acme',
      'Test 1c: Application-owned tenant context reached the tool',
    );
    assert(
      result.output === 'Transfer of $250 completed.',
      'Test 1d: Final model answer returned through AgentRunner',
    );

    await moduleRef.close();
  } catch (err: any) {
    assert(false, 'Test 1: DI wiring for the built-in runtime', err.message);
  }

  // TEST 2: Approval flow works end to end through the module
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Send $5000 to vendor')
      .callTool('transfer', { amount: 5000 })
      .reply('Transfer of $5000 completed after approval.');

    const moduleRef = await bootstrap(model);
    const runner = moduleRef.get(AgentRunner, { strict: false });
    const approvals = moduleRef.get(ApprovalService, { strict: false });
    const ledger = moduleRef.get(LedgerService, { strict: false });

    const result = await runner.run('banker', {
      sessionId: 'sess_di_2',
      message: 'Send $5000 to vendor',
      context: { tenantId: 'acme' },
    });

    const pending = result.toolCalls[0]?.result as any;
    assert(
      pending?.status === 'pending_approval',
      'Test 2a: High-value transfer suspended for approval',
    );
    assert(ledger.transfers.length === 0, 'Test 2b: Side effect withheld before approval');

    const approved = (await approvals.approve(pending.approvalId)) as any;
    assert(
      approved?.toolCalls?.[0]?.result?.success === true,
      'Test 2c: ApprovalService executed the pending tool and resumed the turn',
    );
    assert(ledger.transfers.length === 1, 'Test 2d: Side effect applied exactly once after approval');

    await moduleRef.close();
  } catch (err: any) {
    assert(false, 'Test 2: Approval flow through DI', err.message);
  }

  // TEST 3: Module-level limits apply when a run does not override them
  try {
    const model = new MockModelAdapter();
    const script = model.whenAsked('Loop');
    for (let i = 0; i < 8; i++) {
      script.callTool('transfer', { amount: 1 });
    }
    script.reply('done');

    const moduleRef = await bootstrap(model);
    const runner = moduleRef.get(AgentRunner, { strict: false });

    let caught: any;
    try {
      await runner.run('banker', { sessionId: 'sess_di_3', message: 'Loop' });
    } catch (err) {
      caught = err;
    }

    assert(caught?.kind === 'max_iterations', 'Test 3a: forRoot limits applied to the run');
    assert(caught?.limit === 4, 'Test 3b: Configured iteration budget reported');

    await moduleRef.close();
  } catch (err: any) {
    assert(false, 'Test 3: Module-level execution limits', err.message);
  }

  console.log(`\n  📊 Step 8 Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Step 8 Unit Tests Failed');
  }
}

if (require.main === module) {
  runAgenticModuleTests().catch(() => process.exit(1));
}
