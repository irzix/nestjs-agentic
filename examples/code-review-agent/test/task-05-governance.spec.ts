import * as assert from 'node:assert';
import { ProtectedPathsPolicy } from '../src/policies/protected-paths.policy';
import { RequireMaintainerApprovalPolicy } from '../src/policies/require-maintainer-approval.policy';
import { ApprovalController } from '../src/controllers/approval.controller';
import { ApprovalService, InMemoryApprovalStore, AgentRunner } from 'nestjs-agentic';
import type { AgentContext, PendingApproval } from 'nestjs-agentic';

const mockContext: AgentContext = {
  sessionId: 'sess_test',
  traceId: 'tr_test_123',
  security: {
    userId: 'njent-bot',
    tenantId: 'irzix',
    roles: ['agent'],
    permissions: ['write'],
  },
};

async function runTask05Tests() {
  console.log('🧪 Running Njent Task 05: Governance, Policies & HITL Tests...\n');

  // Test 1: ProtectedPathsPolicy
  const protectedPolicy = new ProtectedPathsPolicy();

  const workflowDeny = await protectedPolicy.evaluate(mockContext, 'push_code_patch', {
    filePath: '.github/workflows/release.yml',
  });
  assert.strictEqual(workflowDeny.decision, 'deny');
  assert.ok(workflowDeny.reason?.includes('strictly denied'));
  console.log('  ✅ PASS: Test 1a: Modification to .github/workflows/ is denied');

  const packageJsonDeny = await protectedPolicy.evaluate(mockContext, 'push_code_patch', {
    filePath: 'package.json',
  });
  assert.strictEqual(packageJsonDeny.decision, 'deny');
  console.log('  ✅ PASS: Test 1b: Modification to package.json is denied');

  const normalFileAllow = await protectedPolicy.evaluate(mockContext, 'push_code_patch', {
    filePath: 'src/orders/order.service.ts',
  });
  assert.strictEqual(normalFileAllow.decision, 'allow');
  console.log('  ✅ PASS: Test 1c: Modification to normal application code is allowed');

  // Test 2: RequireMaintainerApprovalPolicy
  const approvalPolicy = new RequireMaintainerApprovalPolicy();

  const mutatingApproval = await approvalPolicy.evaluate(mockContext, 'git_create_branch_and_commit', {
    branchName: 'njent/fix-issue-12',
  });
  assert.strictEqual(mutatingApproval.decision, 'require_approval');
  assert.ok(mutatingApproval.reason?.includes('requires maintainer authorization'));
  console.log('  ✅ PASS: Test 2: Mutating tool execution intercepted for HITL approval');

  // Test 3: ApprovalController & ApprovalService Settlement
  const approvalStore = new InMemoryApprovalStore();
  const mockRunner = {
    settleApproval: async () => ({
      success: true,
      output: 'Turn resumed after maintainer approval',
      toolCalls: [],
      turns: 1,
    }),
  } as unknown as AgentRunner;

  const approvalService = new ApprovalService(approvalStore, mockRunner);
  const approvalController = new ApprovalController(approvalService);

  const pending: PendingApproval = {
    id: 'appr_101',
    agentName: 'code-fixer',
    toolName: 'git_create_branch_and_commit',
    args: { branchName: 'njent/fix-test' },
    context: mockContext,
    reason: 'Requires maintainer authorization',
    createdAt: new Date(),
  };

  await approvalStore.save(pending);

  const settleResult = await approvalController.settleApproval('appr_101', {
    action: 'approve',
    maintainerToken: 'valid-maintainer-token',
  });

  assert.ok(settleResult);
  console.log('  ✅ PASS: Test 3: Approval settled via REST controller and resumed');

  console.log('\n🎉 All 3 Task 05 Governance tests passed successfully!\n');
}

runTask05Tests().catch((err) => {
  console.error('❌ Task 05 tests failed:', err);
  process.exit(1);
});
