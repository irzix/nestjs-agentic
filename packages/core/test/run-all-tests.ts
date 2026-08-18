import { runAgentExecutorTests } from './agent-executor.spec';
import { runAgentRunnerTests } from './agent-runner.spec';
import { runAgenticModuleTests } from './agentic-module.spec';
import { runApprovalServiceTests } from './approval-service.spec';
import { runApprovalStoreContractTests } from './approval-store-contract.spec';
import { runAuditTrailTests } from './audit-trail.spec';
import { runConversationHistoryTests } from './conversation-history.spec';
import { runCrashRecoveryHitlTests } from './crash-recovery-hitl.spec';
import { runIdempotencyTests } from './idempotency.spec';
import { runLocalToolProviderTests } from './local-tool-provider.spec';
import { runModelAdapterContractTests } from './model-adapter-contract.spec';
import { runObserversTests } from './observers.spec';
import { runPolicyTests } from './policies.spec';
import { runPostgresStoresTests } from './postgres-stores.spec';
import { runSessionStoreContractTests } from './session-store-contract.spec';
import { runStreamingTests } from './streaming.spec';
import { runToolDiscoveryTests } from './tool-discovery.spec';
import { runModelCascadeTests } from './model-cascade.spec';
import { runUCurveFormatterTests } from './u-curve-formatter.spec';

async function runAllCoreTests() {
  console.log('====================================================');
  console.log('🚀 Executing @nestjs-agentic/core Comprehensive Test Suite');
  console.log('====================================================\n');

  try {
    await runToolDiscoveryTests();
    await runLocalToolProviderTests();
    await runApprovalServiceTests();
    await runAgentRunnerTests();
    await runPolicyTests();
    await runStreamingTests();
    await runAgentExecutorTests();
    await runAgenticModuleTests();
    await runModelAdapterContractTests();
    await runConversationHistoryTests();
    await runApprovalStoreContractTests();
    await runSessionStoreContractTests();
    await runIdempotencyTests();
    await runAuditTrailTests();
    await runPostgresStoresTests();
    await runObserversTests();
    await runCrashRecoveryHitlTests();
    await runModelCascadeTests();
    await runUCurveFormatterTests();

    console.log('====================================================');
    console.log('🎉 ALL 19 CORE UNIT & INTEGRATION TEST SUITES PASSED SUCCESSFULLY!');
    console.log('====================================================\n');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('\n❌ TEST SUITE FAILURE:', message);
    process.exit(1);
  }
}

runAllCoreTests();
