import { runAgentExecutorTests } from './agent-executor.spec';
import { runAgentRunnerTests } from './agent-runner.spec';
import { runAgenticModuleTests } from './agentic-module.spec';
import { runApprovalServiceTests } from './approval-service.spec';
import { runApprovalStoreContractTests } from './approval-store-contract.spec';
import { runAuditTrailTests } from './audit-trail.spec';
import { runConversationHistoryTests } from './conversation-history.spec';
import { runLocalToolProviderTests } from './local-tool-provider.spec';
import { runModelAdapterContractTests } from './model-adapter-contract.spec';
import { runPolicyTests } from './policies.spec';
import { runStreamingTests } from './streaming.spec';
import { runToolDiscoveryTests } from './tool-discovery.spec';

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
    await runAuditTrailTests();

    console.log('====================================================');
    console.log('🎉 ALL 12 CORE UNIT TEST SUITES PASSED SUCCESSFULLY!');
    console.log('====================================================\n');
  } catch (err: any) {
    console.error('\n❌ TEST SUITE FAILURE:', err.message);
    process.exit(1);
  }
}

runAllCoreTests();
