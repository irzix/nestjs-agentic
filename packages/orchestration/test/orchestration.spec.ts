import 'reflect-metadata';
import {
  Agent,
  AgentRunner,
  InMemoryApprovalStore,
  LocalToolProvider,
  ToolDiscoveryService,
} from '@nestjs-agentic/core';
import {
  ParallelSubAgentRunner,
  RefinementLoopRunner,
  SubAgentDelegator,
} from '../src';

export async function runOrchestrationTests() {
  console.log('🧪 Running @nestjs-agentic/orchestration Unit Tests...\n');

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

  // Setup Agent Providers & LocalToolProvider
  function createAgent(name: string) {
    @Agent({ name, description: name })
    class TestAgent {
      define() {
        return { name, instructions: 'Test Agent Instructions', tools: [] };
      }
    }
    return new TestAgent();
  }

  const agentSubA = createAgent('sub_agent_a');
  const agentA = createAgent('agent_a');
  const agentB = createAgent('agent_b');
  const agentSlow = createAgent('agent_slow');
  const agentWriter = createAgent('writer_agent');

  const discovery = new ToolDiscoveryService();
  const store = new InMemoryApprovalStore();
  const mockModuleRef = { get: () => null } as any;

  const localToolProvider = new LocalToolProvider([], store, discovery, mockModuleRef);

  const responsesMap = new Map<string, string>([
    ['Perform SubTask A', 'Task A Completed Successfully'],
    ['Perform SubTask B', 'Task B Completed Successfully'],
    ['Draft initial report', 'Draft v1 containing errors'],
    ['Refine report', 'Draft v2 perfectly refined'],
  ]);

  const mockAdapter = {
    async execute(input: any) {
      if (input.message.includes('Hanging Task')) {
        await new Promise((r) => setTimeout(r, 300));
      }
      if (input.message.includes('Refinement Feedback')) {
        return {
          sessionId: input.sessionId,
          output: 'Draft v2 perfectly refined',
          toolCalls: [],
        };
      }
      return {
        sessionId: input.sessionId,
        output: responsesMap.get(input.message) || `Processed ${input.message}`,
        toolCalls: [],
      };
    },
  };

  const runner = new AgentRunner(
    [agentSubA, agentA, agentB, agentSlow, agentWriter],
    mockAdapter as any,
    { defaultModel: { provider: 'mock', model: 'mock-model' } },
    localToolProvider,
    mockModuleRef,
  );

  // TEST 1: SubAgentDelegator Context Propagation
  try {
    const delegator = new SubAgentDelegator(runner);
    const parentContext = { userId: 'usr_owner', tenantId: 'tenant_acme', roles: ['admin'] };
    const result = await delegator.delegate('sess_p1', parentContext, {
      agentName: 'sub_agent_a',
      message: 'Perform SubTask A',
    });

    assert(result.status === 'success', 'Test 1a: SubAgentDelegator executed sub-task', result.error);
    assert(result.response.includes('Task A Completed'), 'Test 1b: SubAgentDelegator returned response output', result.response);
  } catch (err: any) {
    assert(false, 'Test 1: SubAgentDelegator Context Propagation', err.message);
  }

  // TEST 2: ParallelSubAgentRunner Fan-Out Execution
  try {
    const parallelRunner = new ParallelSubAgentRunner(runner, { aggregationStrategy: 'consensusMerge' });
    const parentContext = { userId: 'usr_owner', tenantId: 'tenant_acme', roles: ['admin'] };
    const tasks = [
      { agentName: 'agent_a', message: 'Perform SubTask A' },
      { agentName: 'agent_b', message: 'Perform SubTask B' },
    ];

    const result = await parallelRunner.runParallel('sess_p2', parentContext, tasks);

    assert(result.successCount === 2, 'Test 2a: ParallelSubAgentRunner executed all tasks in parallel');
    assert(result.results.length === 2, 'Test 2b: Returned results for all parallel sub-agents');
    assert(
      result.combinedResponse.includes('[agent_a]') && result.combinedResponse.includes('[agent_b]'),
      'Test 2c: consensusMerge merged all sub-agent responses',
    );
  } catch (err: any) {
    assert(false, 'Test 2: ParallelSubAgentRunner Fan-Out Execution', err.message);
  }

  // TEST 3: ParallelSubAgentRunner Timeout Resiliency
  try {
    const parallelRunner = new ParallelSubAgentRunner(runner, { timeoutMs: 50 });
    const parentContext = { userId: 'usr_owner', tenantId: 'tenant_acme', roles: ['admin'] };
    const tasks = [
      { agentName: 'agent_slow', message: 'Hanging Task That Times Out' },
    ];

    const result = await parallelRunner.runParallel('sess_p3', parentContext, tasks);

    assert(result.failedCount === 1, 'Test 3a: ParallelSubAgentRunner caught timeout error');
    assert(result.results[0].error!.includes('timed out'), 'Test 3b: Error message specifies timeout duration');
  } catch (err: any) {
    assert(false, 'Test 3: ParallelSubAgentRunner Timeout Resiliency', err.message);
  }

  // TEST 4: RefinementLoopRunner Iterative Supervisor-Worker Loop
  try {
    const loopRunner = new RefinementLoopRunner(runner, {
      maxIterations: 3,
      satisfactionFn: (res, iter) => res.response.includes('perfectly refined'),
    });

    const parentContext = { userId: 'usr_owner', tenantId: 'tenant_acme', roles: ['admin'] };
    const result = await loopRunner.runLoop(
      'sess_p4',
      parentContext,
      { agentName: 'writer_agent', message: 'Draft initial report' },
      (lastRes, iter) => 'Fix typos and polish language',
    );

    assert(result.satisfied === true, 'Test 4a: RefinementLoopRunner satisfied loop termination condition');
    assert(result.iterations >= 1, 'Test 4b: RefinementLoopRunner recorded loop iteration count');
  } catch (err: any) {
    assert(false, 'Test 4: RefinementLoopRunner Iterative Loop', err.message);
  }

  console.log(`\n  📊 Orchestration Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Orchestration Unit Tests Failed');
  }
}

if (require.main === module) {
  runOrchestrationTests().catch(() => process.exit(1));
}
