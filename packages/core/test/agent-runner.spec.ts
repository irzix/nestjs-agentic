import 'reflect-metadata';
import { ModuleRef } from '@nestjs/core';
import {
  Agent,
  AgentRunner,
  LocalToolProvider,
  MockRuntimeAdapter,
  ToolDiscoveryService,
} from '../src';
import type { AgentConfig, AgentProvider, AgentResult } from '../src';
import { InMemoryApprovalStore } from '../src/stores/in-memory-approval.store';

@Agent({
  name: 'customer-agent',
  description: 'Customer Service Representative Agent',
})
class CustomerAgent implements AgentProvider {
  define(): AgentConfig {
    return {
      instructions: 'You are a helpful support agent.',
      tools: [],
    };
  }
}

class MockModuleRef {
  get(token: any): any {
    return undefined;
  }
}

export async function runAgentRunnerTests() {
  console.log('🤖 Running Step 4: AgentRunner Unit Tests...\n');

  const mockAdapter = new MockRuntimeAdapter();
  const discovery = new ToolDiscoveryService();
  const store = new InMemoryApprovalStore();
  const moduleRef = new MockModuleRef() as unknown as ModuleRef;

  const localToolProvider = new LocalToolProvider([], store, discovery, moduleRef);
  const agentInstance = new CustomerAgent();

  const runner = new AgentRunner(
    [agentInstance],
    mockAdapter,
    { defaultModel: { provider: 'google', model: 'gemini-2.0-flash' } },
    localToolProvider,
    moduleRef,
  );

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

  // TEST 1: Registered Agent Execution & Dispatch
  try {
    mockAdapter.reset();

    const result: AgentResult = await runner.run('customer-agent', {
      sessionId: 'sess_1001',
      message: 'Hello support',
      context: {
        userId: 'usr_customer_1',
        tenantId: 'tenant_main',
      },
    });

    assert(result.sessionId === 'sess_1001', 'Test 1a: Returns correct sessionId in result');
    assert(
      result.output.includes('Hello support'),
      'Test 1b: Returns response output from RuntimeAdapter',
    );
  } catch (err: any) {
    assert(false, 'Test 1: Agent Execution & Dispatch', err.message);
  }

  // TEST 2: Unregistered Agent Name Error Handling
  try {
    let threw = false;
    try {
      await runner.run('unknown-agent-name', {
        sessionId: 'sess_1002',
        message: 'Hi',
      });
    } catch (err: any) {
      threw = true;
      assert(
        err.message.includes('unknown-agent-name'),
        'Test 2a: Error message contains unregistered agent name',
      );
    }
    assert(threw, 'Test 2b: Running unregistered agent throws Error');
  } catch (err: any) {
    assert(false, 'Test 2: Unregistered Agent Error', err.message);
  }

  console.log(`\n  📊 Step 4 Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Step 4 Unit Tests Failed');
  }
}

// Run directly if executed via node
if (require.main === module) {
  runAgentRunnerTests().catch(() => process.exit(1));
}
