import { Test } from '@nestjs/testing';
import { AgentRunner, ApprovalService, MockRuntimeAdapter, RUNTIME_ADAPTER } from 'nestjs-agentic';
import type { ToolExecutionResult } from 'nestjs-agentic';
import { AppModule } from './app.module';

async function runTests() {
  console.log('🧪 Starting Financial Governance Integration Tests...\n');

  const mockAdapter = new MockRuntimeAdapter();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(RUNTIME_ADAPTER)
    .useValue(mockAdapter)
    .compile();

  const runner = moduleRef.get(AgentRunner);
  const approvalService = moduleRef.get(ApprovalService);

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // TEST 1: Low-risk transfer ($500) -> Allowed
  try {
    mockAdapter.reset();
    mockAdapter
      .whenAsked('Transfer $500 from ACC-1 to ACC-2')
      .thenCallTool('transferFunds', { fromAccount: 'ACC-1', toAccount: 'ACC-2', amount: 500 });

    const result = await runner.run('banking-agent', {
      sessionId: 's1',
      message: 'Transfer $500 from ACC-1 to ACC-2',
      context: {
        userId: 'usr_safe',
        tenantId: 'acme_corp',
        roles: ['finance_officer'],
      },
    });

    const res = result.toolCalls[0]?.result as ToolExecutionResult;
    const isSuccess = res && res.success === true;
    assert(isSuccess, 'Test 1: Low-risk transfer ($500) is auto-allowed');
  } catch (err: any) {
    assert(false, 'Test 1: Low-risk transfer', err.message);
  }

  // TEST 2: High-risk role failure ($6,000 without finance_officer role) -> Denied
  try {
    mockAdapter.reset();
    mockAdapter
      .whenAsked('Transfer $6000 from ACC-1 to ACC-2')
      .thenCallTool('transferFunds', { fromAccount: 'ACC-1', toAccount: 'ACC-2', amount: 6000 });

    const result = await runner.run('banking-agent', {
      sessionId: 's2',
      message: 'Transfer $6000 from ACC-1 to ACC-2',
      context: {
        userId: 'usr_regular',
        tenantId: 'acme_corp',
        roles: ['regular_user'], // Missing finance_officer
      },
    });

    const res = result.toolCalls[0]?.result as ToolExecutionResult;
    const isDenied = res && res.success === false && res.status === 'denied';
    const reason = isDenied ? res.reason : '';
    assert(
      isDenied && reason.includes('finance_officer'),
      'Test 2: High-amount transfer without finance_officer role is denied',
      `Reason: ${reason}`,
    );
  } catch (err: any) {
    assert(false, 'Test 2: Role failure', err.message);
  }

  // TEST 3: Suspended Tenant -> Denied
  try {
    mockAdapter.reset();
    mockAdapter
      .whenAsked('Transfer $100 from ACC-1 to ACC-2')
      .thenCallTool('transferFunds', { fromAccount: 'ACC-1', toAccount: 'ACC-2', amount: 100 });

    const result = await runner.run('banking-agent', {
      sessionId: 's3',
      message: 'Transfer $100 from ACC-1 to ACC-2',
      context: {
        userId: 'usr_safe',
        tenantId: 'suspended_tenant',
        roles: ['finance_officer'],
      },
    });

    const res = result.toolCalls[0]?.result as ToolExecutionResult;
    const isDenied = res && res.success === false && res.status === 'denied';
    assert(isDenied, 'Test 3: Suspended tenant transfer is denied by TenantIsolationPolicy');
  } catch (err: any) {
    assert(false, 'Test 3: Suspended Tenant', err.message);
  }

  // TEST 4: High-Value Transfer ($25,000) -> Pending Approval & Approval Lifecycle
  try {
    mockAdapter.reset();
    mockAdapter
      .whenAsked('Transfer $25000 from ACC-1 to ACC-2')
      .thenCallTool('transferFunds', { fromAccount: 'ACC-1', toAccount: 'ACC-2', amount: 25000 });

    const result = await runner.run('banking-agent', {
      sessionId: 's4',
      message: 'Transfer $25000 from ACC-1 to ACC-2',
      context: {
        userId: 'usr_mgr',
        tenantId: 'acme_corp',
        roles: ['finance_officer'],
      },
    });

    const res = result.toolCalls[0]?.result as ToolExecutionResult;
    const isPending = res && res.success === false && res.status === 'pending_approval';
    const approvalId = isPending ? res.approvalId : undefined;

    assert(
      isPending && Boolean(approvalId),
      'Test 4a: Transfer of $25,000 triggers HITL pending_approval state',
      `approvalId: ${approvalId}`,
    );

    if (approvalId) {
      // Execute human approval
      const approvalResult = await approvalService.approve(approvalId);
      assert(
        approvalResult.success === true,
        'Test 4b: Human Approval executing pending tool closure succeeds',
      );
    }
  } catch (err: any) {
    assert(false, 'Test 4: HITL Approval Lifecycle', err.message);
  }

  console.log(`\n📊 Summary: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
