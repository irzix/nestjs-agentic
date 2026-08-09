import 'reflect-metadata';
import { ApprovalService } from '../src';
import type { AgentContext, ToolExecutionResult } from '../src';
import { InMemoryApprovalStore } from '../src/stores/in-memory-approval.store';

export async function runApprovalServiceTests() {
  console.log('👥 Running Step 3: ApprovalService (HITL Lifecycle) Unit Tests...\n');

  const store = new InMemoryApprovalStore();
  const service = new ApprovalService(store);
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

  const dummyContext: AgentContext = {
    sessionId: 'session_hitl',
    traceId: 'trace_hitl',
    security: { userId: 'usr_manager', tenantId: 'acme' },
  };

  // Seed store with 2 pending requests
  let executedToolA: boolean = false;
  await store.save({
    id: 'approval_111',
    toolName: 'transferMoney',
    args: { amount: 5000 },
    context: dummyContext,
    reason: 'Requires manager approval',
    createdAt: new Date(),
    execute: async () => {
      executedToolA = true;
      return { success: true, data: { txId: 'tx_approved_111' } };
    },
  });

  await store.save({
    id: 'approval_222',
    toolName: 'deleteRecord',
    args: { recordId: 'rec_999' },
    context: dummyContext,
    reason: 'Destructive action',
    createdAt: new Date(),
    execute: async () => {
      return { success: true, data: { deleted: true } };
    },
  });

  // TEST 1: Retrieve seeded requests from store
  try {
    const record1 = await store.get('approval_111');
    const record2 = await store.get('approval_222');
    assert(record1 !== undefined && record2 !== undefined, 'Test 1a: Seeded 2 approval requests into store');
    assert(record1?.toolName === 'transferMoney', 'Test 1b: Record toolName matches "transferMoney"');
  } catch (err: any) {
    assert(false, 'Test 1: Store Seed Retrieval', err.message);
  }

  // TEST 2: approve(approvalId) Execution
  try {
    const res = await service.approve('approval_111');
    const isSuccess = (res as { success: boolean }).success === true;
    assert(isSuccess, 'Test 2a: approve() returns success: true');
    assert(Boolean(executedToolA), 'Test 2b: Stored tool execution closure executed');
    assert(
      isSuccess && (res as any).data?.txId === 'tx_approved_111',
      'Test 2c: Result data returned from executed tool closure',
    );

    // Verify record removed from store
    const remainingRecord = await store.get('approval_111');
    assert(remainingRecord == null, 'Test 2d: Record removed from store post-approval');
  } catch (err: any) {
    assert(false, 'Test 2: approve() Execution', err.message);
  }

  // TEST 3: reject(approvalId) Removal
  try {
    await service.reject('approval_222');
    const remainingRecord = await store.get('approval_222');
    assert(remainingRecord == null, 'Test 3: reject() removes request from store without execution');
  } catch (err: any) {
    assert(false, 'Test 3: reject() Removal', err.message);
  }

  // TEST 4: Non-existent Approval ID Error Handling
  try {
    let approveThrew: boolean = false;
    try {
      await service.approve('non_existent_id');
    } catch {
      approveThrew = true;
    }
    assert(Boolean(approveThrew), 'Test 4a: approve() with unknown ID throws error');

    let rejectThrew: boolean = false;
    try {
      await service.reject('non_existent_id');
    } catch {
      rejectThrew = true;
    }
    assert(Boolean(rejectThrew), 'Test 4b: reject() with unknown ID throws error');
  } catch (err: any) {
    assert(false, 'Test 4: Error Handling', err.message);
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
