import 'reflect-metadata';
import {
  Agent,
  AgentContext,
  AgentExecutor,
  AgentResult,
  AgentRunner,
  InMemoryApprovalStore,
  LocalToolProvider,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  Param,
  Tool,
  ToolDiscoveryService,
  ToolSet,
  UsePolicies,
} from '@nestjs-agentic/core';
import {
  CapabilityNarrowingPolicy,
  MaxDelegationDepthExceededError,
  ParallelSubAgentRunner,
  RefinementLoopRunner,
  SubAgentDelegator,
} from '../src';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

// -----------------------------------------------------------------------------
// Test ToolSets & Agents
// -----------------------------------------------------------------------------

@ToolSet({ name: 'finance' })
class FinanceToolSet {
  readonly transfers: Array<{ amount: number; recipient: string }> = [];

  @Tool({ name: 'getBalance', description: 'Get account balance' })
  @UsePolicies(CapabilityNarrowingPolicy)
  getBalance() {
    return { balance: 5000, currency: 'USD' };
  }

  @Tool({ name: 'transferFunds', description: 'Transfer funds to another account' })
  @UsePolicies(CapabilityNarrowingPolicy)
  transferFunds(
    @Param('amount') amount: number,
    @Param('recipient') recipient: string,
  ) {
    this.transfers.push({ amount, recipient });
    return { status: 'success', amount, recipient };
  }

  @Tool({ name: 'auditLogs', description: 'View financial audit logs' })
  @UsePolicies(CapabilityNarrowingPolicy)
  auditLogs() {
    return { logs: ['TX_101', 'TX_102'] };
  }
}

import type { AgentProvider } from '@nestjs-agentic/core';

function createAgent(name: string, tools: object[] = []): AgentProvider {
  @Agent({ name, description: name })
  class TestAgent implements AgentProvider {
    define() {
      return { instructions: `Instructions for ${name}`, tools };
    }
  }
  return new TestAgent();
}

export async function runOrchestrationTests() {
  console.log('🧪 Running @nestjs-agentic/orchestration Comprehensive Unit & Security Tests...\n');

  const financeTools = new FinanceToolSet();
  const capabilityPolicy = new CapabilityNarrowingPolicy();
  const agentSubA = createAgent('sub_agent_a');
  const agentA = createAgent('agent_a');
  const agentB = createAgent('agent_b');
  const agentSlow = createAgent('agent_slow');
  const agentWriter = createAgent('writer_agent');
  const agentFallback = createAgent('fallback_agent');
  const agentFinance = createAgent('finance_agent', [financeTools]);

  const discovery = new ToolDiscoveryService();
  const store = new InMemoryApprovalStore();
  const mockModuleRef = {
    get: (token: unknown) => {
      if (token === FinanceToolSet) return financeTools;
      if (token === CapabilityNarrowingPolicy) return capabilityPolicy;
      return null;
    },
  };

  const localToolProvider = new LocalToolProvider(
    [capabilityPolicy],
    store,
    discovery,
    mockModuleRef as never,
  );

  const capturedContexts: AgentContext[] = [];

  const mockAdapter: ModelAdapter = {
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const messages = request.messages;
      const lastUserMsg = messages.slice().reverse().find((m) => m.role === 'user')?.content || '';

      const isAgentSlow = messages.some((m) => m.content.includes('agent_slow'));
      if (isAgentSlow && lastUserMsg.includes('Hanging Task')) {
        await new Promise((r) => setTimeout(r, 300));
      }

      if (lastUserMsg.includes('Refinement Feedback')) {
        return { content: 'Draft v2 perfectly refined' };
      }
      if (lastUserMsg === 'Perform SubTask A') {
        return { content: 'Task A Completed Successfully' };
      }
      if (lastUserMsg === 'Perform SubTask B') {
        return { content: 'Task B Completed Successfully' };
      }
      if (lastUserMsg === 'Draft initial report') {
        return { content: 'Draft v1 containing errors' };
      }

      // Tool invocation triggers
      if (lastUserMsg.includes('Call getBalance')) {
        const lastToolMsg = messages.find((m) => m.role === 'tool');
        if (!lastToolMsg) {
          return {
            content: 'Checking balance...',
            toolCalls: [{ id: 'call_bal_1', name: 'getBalance', args: {} }],
          };
        }
        return { content: `Balance retrieved: ${lastToolMsg.content}` };
      }

      if (lastUserMsg.includes('Call transferFunds')) {
        const lastToolMsg = messages.find((m) => m.role === 'tool');
        if (!lastToolMsg) {
          return {
            content: 'Transferring funds...',
            toolCalls: [
              { id: 'call_tx_1', name: 'transferFunds', args: { amount: 500, recipient: 'vendor_x' } },
            ],
          };
        }
        return { content: `Transfer result: ${lastToolMsg.content}` };
      }

      return { content: `Processed ${lastUserMsg}` };
    },
  };

  const executor = new AgentExecutor(mockAdapter);
  const runner = new AgentRunner(
    [agentSubA, agentA, agentB, agentSlow, agentWriter, agentFallback, agentFinance],
    undefined,
    { defaultModel: { provider: 'mock', model: 'mock-model' } },
    localToolProvider,
    mockModuleRef as never,
    executor,
  );

  // Hook into runner to capture dispatched AgentContext for verification
  const originalPrepare = runner.prepare.bind(runner);
  runner.prepare = (agentName, input) => {
    const prepared = originalPrepare(agentName, input);
    capturedContexts.push(prepared.context);
    return prepared;
  };

  // =========================================================================
  // TEST 1: SubAgentDelegator Context Propagation & Session Namespacing
  // =========================================================================
  {
    console.log('  - Test 1: SubAgentDelegator Context Propagation & Session Namespacing');
    const delegator = new SubAgentDelegator(runner);
    const parentContext: AgentContext = {
      sessionId: 'sess_p1',
      traceId: 'trace_parent_001',
      rootTraceId: 'trace_root_001',
      security: {
        userId: 'usr_owner',
        tenantId: 'tenant_acme',
        roles: ['admin'],
        permissions: ['read', 'write'],
      },
    };

    const result = await delegator.delegate(
      parentContext,
      {
        agentName: 'sub_agent_a',
        message: 'Perform SubTask A',
      },
      2,
    );

    assert(result.status === 'success', 'SubAgentDelegator executed sub-task');
    assert(result.response.includes('Task A Completed'), 'SubAgentDelegator returned response output');

    // Verify context received by sub-agent
    const subContext = capturedContexts[capturedContexts.length - 1];
    assert(subContext.sessionId === 'sess_p1:sub_agent_a:iter_2', 'SessionId namespaced correctly');
    assert(subContext.security.tenantId === 'tenant_acme', 'TenantId strictly preserved from parent');
    assert(subContext.security.userId === 'usr_owner', 'UserId preserved');
    assert(subContext.parentTraceId === 'trace_parent_001', 'ParentTraceId propagated');
    assert(subContext.rootTraceId === 'trace_root_001', 'RootTraceId propagated');
    console.log('    ✓ Sub-agent context namespacing & tenant preservation verified');
  }

  // =========================================================================
  // TEST 2: ParallelSubAgentRunner Fan-Out Execution
  // =========================================================================
  {
    console.log('  - Test 2: ParallelSubAgentRunner Fan-Out Execution & Consensus Merge');
    const parallelRunner = new ParallelSubAgentRunner(runner, { aggregationStrategy: 'consensusMerge' });
    const parentContext: AgentContext = {
      sessionId: 'sess_p2',
      traceId: 'trace_p2',
      security: { userId: 'usr_owner', tenantId: 'tenant_acme', roles: ['admin'] },
    };
    const tasks = [
      { agentName: 'agent_a', message: 'Perform SubTask A' },
      { agentName: 'agent_b', message: 'Perform SubTask B' },
    ];

    const result = await parallelRunner.runParallel(parentContext, tasks);

    assert(result.successCount === 2, 'ParallelSubAgentRunner executed all tasks in parallel');
    assert(result.results.length === 2, 'Returned results for all parallel sub-agents');
    assert(
      result.combinedResponse.includes('[SubAgent: agent_a]') &&
        result.combinedResponse.includes('[SubAgent: agent_b]'),
      'consensusMerge merged all sub-agent responses',
    );
    console.log('    ✓ Parallel fan-out & consensus merge verified');
  }

  // =========================================================================
  // TEST 3: ParallelSubAgentRunner Timeout Resiliency
  // =========================================================================
  {
    console.log('  - Test 3: ParallelSubAgentRunner Timeout Resiliency');
    const parallelRunner = new ParallelSubAgentRunner(runner, { timeoutMs: 50, retriesPerSubAgent: 0 });
    const parentContext: AgentContext = {
      sessionId: 'sess_p3',
      traceId: 'trace_p3',
      security: { userId: 'usr_owner', tenantId: 'tenant_acme' },
    };
    const tasks = [{ agentName: 'agent_slow', message: 'Hanging Task That Times Out' }];

    const result = await parallelRunner.runParallel(parentContext, tasks);

    assert(result.failedCount === 1, 'ParallelSubAgentRunner caught timeout error');
    assert(result.results[0].error!.includes('timed out'), 'Error message specifies timeout duration');
    console.log('    ✓ Timeout handling verified');
  }

  // =========================================================================
  // TEST 4: ParallelSubAgentRunner Fallback Recovery
  // =========================================================================
  {
    console.log('  - Test 4: ParallelSubAgentRunner Fallback Recovery');
    const parallelRunner = new ParallelSubAgentRunner(runner, {
      timeoutMs: 50,
      retriesPerSubAgent: 0,
      fallbackAgentName: 'fallback_agent',
    });
    const parentContext: AgentContext = {
      sessionId: 'sess_p4',
      traceId: 'trace_p4',
      security: { userId: 'usr_owner', tenantId: 'tenant_acme' },
    };
    const tasks = [{ agentName: 'agent_slow', message: 'Hanging Task' }];

    const result = await parallelRunner.runParallel(parentContext, tasks);
    assert(result.successCount === 1, 'ParallelSubAgentRunner recovered via fallback agent');
    assert(result.results[0].agentName.includes('fallback: fallback_agent'), 'Result identifies fallback agent');
    console.log('    ✓ Fallback agent recovery verified');
  }

  // =========================================================================
  // TEST 5: RefinementLoopRunner Iterative Supervisor-Worker Loop
  // =========================================================================
  {
    console.log('  - Test 5: RefinementLoopRunner Iterative Supervisor-Worker Loop');
    const loopRunner = new RefinementLoopRunner(runner, {
      maxIterations: 3,
      satisfactionFn: (res) => Promise.resolve(res.response.includes('perfectly refined')),
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_p5',
      traceId: 'trace_p5',
      security: { userId: 'usr_owner', tenantId: 'tenant_acme' },
    };
    const result = await loopRunner.runLoop(
      parentContext,
      { agentName: 'writer_agent', message: 'Draft initial report' },
      () => 'Refinement Feedback: Fix typos and polish language',
    );

    assert(result.satisfied === true, 'RefinementLoopRunner satisfied loop termination condition');
    assert(result.iterations >= 1, 'RefinementLoopRunner recorded loop iteration count');
    console.log('    ✓ Refinement loop supervisor feedback verified');
  }

  // =========================================================================
  // TEST 6: ParallelSubAgentRunner Bounded Concurrency
  // =========================================================================
  {
    console.log('  - Test 6: ParallelSubAgentRunner Bounded Concurrency');
    let currentConcurrent = 0;
    let peakConcurrent = 0;

    const concurrentAdapter: ModelAdapter = {
      async generate(request: ModelRequest): Promise<ModelResponse> {
        currentConcurrent++;
        if (currentConcurrent > peakConcurrent) {
          peakConcurrent = currentConcurrent;
        }
        await new Promise((r) => setTimeout(r, 30));
        currentConcurrent--;
        return { content: `Done: ${request.messages[request.messages.length - 1].content}` };
      },
    };

    const concurrentExecutor = new AgentExecutor(concurrentAdapter);
    const concurrentRunner = new AgentRunner(
      [agentA, agentB, agentSubA, agentSlow],
      undefined,
      { defaultModel: { provider: 'mock', model: 'mock-model' } },
      localToolProvider,
      mockModuleRef as never,
      concurrentExecutor,
    );

    const parallelRunner = new ParallelSubAgentRunner(concurrentRunner, { maxConcurrency: 2 });
    const parentContext: AgentContext = {
      sessionId: 'sess_p6',
      traceId: 'trace_p6',
      security: { userId: 'usr_owner', tenantId: 'tenant_acme' },
    };
    const tasks = [
      { agentName: 'agent_a', message: 'Task 1' },
      { agentName: 'agent_b', message: 'Task 2' },
      { agentName: 'sub_agent_a', message: 'Task 3' },
      { agentName: 'agent_a', message: 'Task 4' },
    ];

    const result = await parallelRunner.runParallel(parentContext, tasks);
    assert(result.successCount === 4, 'All tasks completed successfully under bounded concurrency');
    assert(peakConcurrent === 2, `Concurrency limit respected (peak: ${peakConcurrent}, expected: 2)`);
    console.log('    ✓ Bounded concurrency pool verified');
  }

  // =========================================================================
  // TEST 7: ParallelSubAgentRunner AbortSignal Cancellation
  // =========================================================================
  {
    console.log('  - Test 7: ParallelSubAgentRunner AbortSignal Cancellation');
    const controller = new AbortController();
    controller.abort();

    const parallelRunner = new ParallelSubAgentRunner(runner, { signal: controller.signal });
    const parentContext: AgentContext = {
      sessionId: 'sess_p7',
      traceId: 'trace_p7',
      security: { userId: 'usr_owner', tenantId: 'tenant_acme' },
    };
    const tasks = [
      { agentName: 'agent_a', message: 'Task 1' },
      { agentName: 'agent_b', message: 'Task 2' },
    ];

    const result = await parallelRunner.runParallel(parentContext, tasks);
    assert(result.failedCount === 2, 'Pre-aborted signal cancels all tasks immediately');
    assert(result.results[0].error!.includes('aborted'), 'Failure reason notes cancellation');

    // In-flight cancellation
    const inFlightController = new AbortController();
    const inFlightRunner = new ParallelSubAgentRunner(runner, {
      signal: inFlightController.signal,
      timeoutMs: 1000,
    });

    const startTime = Date.now();
    setTimeout(() => inFlightController.abort(), 20);

    const inFlightResult = await inFlightRunner.runParallel(parentContext, [
      { agentName: 'agent_slow', message: 'Hanging Task' },
    ]);
    const duration = Date.now() - startTime;

    assert(inFlightResult.failedCount === 1, 'In-flight abort cancelled running sub-agent');
    assert(
      duration < 200,
      `Cancelled immediately in ${duration}ms without waiting for 1000ms timeout`,
    );
    console.log('    ✓ In-flight cancellation verified');
  }

  // =========================================================================
  // TEST 8: Capability Narrowing: Tool Whitelisting (allowedTools)
  // =========================================================================
  {
    console.log('  - Test 8: Capability Narrowing Tool Whitelisting (allowedTools)');
    const delegator = new SubAgentDelegator(runner);
    const parentContext: AgentContext = {
      sessionId: 'sess_whitelist_1',
      traceId: 'trace_parent_w',
      security: {
        userId: 'usr_analyst',
        tenantId: 'tenant_enterprise',
        roles: ['analyst'],
      },
    };

    // Sub-agent delegated with allowedTools: ['getBalance']
    // Case A: Allowed tool succeeds
    const allowedRes = await delegator.delegate(parentContext, {
      agentName: 'finance_agent',
      message: 'Call getBalance',
      narrowing: {
        allowedTools: ['getBalance'],
      },
    });

    assert(allowedRes.status === 'success', 'Whitelisted tool executed successfully');
    assert(allowedRes.response.includes('5000'), 'Whitelisted tool output returned');

    // Case B: Disallowed tool blocked by policy
    const deniedRes = await delegator.delegate(parentContext, {
      agentName: 'finance_agent',
      message: 'Call transferFunds',
      narrowing: {
        allowedTools: ['getBalance'], // transferFunds is not in whitelist
      },
    });

    assert(
      deniedRes.response.includes('denied') || deniedRes.response.includes('not permitted'),
      'Non-whitelisted tool call was denied by capability policy',
    );
    assert(financeTools.transfers.length === 0, 'Denied tool side effect never executed');
    console.log('    ✓ Tool whitelisting enforcement verified');
  }

  // =========================================================================
  // TEST 9: Capability Narrowing: Tool Blacklisting (deniedTools)
  // =========================================================================
  {
    console.log('  - Test 9: Capability Narrowing Tool Blacklisting (deniedTools)');
    const delegator = new SubAgentDelegator(runner);
    const parentContext: AgentContext = {
      sessionId: 'sess_blacklist_1',
      traceId: 'trace_parent_b',
      security: {
        userId: 'usr_intern',
        tenantId: 'tenant_enterprise',
        roles: ['intern'],
      },
    };

    // Sub-agent delegated with deniedTools: ['transferFunds']
    const deniedRes = await delegator.delegate(parentContext, {
      agentName: 'finance_agent',
      message: 'Call transferFunds',
      narrowing: {
        deniedTools: ['transferFunds'],
      },
    });

    assert(
      deniedRes.response.includes('prohibited') || deniedRes.response.includes('denied'),
      'Blacklisted tool call was denied by capability policy',
    );
    assert(financeTools.transfers.length === 0, 'Blacklisted tool side effect never executed');
    console.log('    ✓ Tool blacklisting enforcement verified');
  }

  // =========================================================================
  // TEST 10: Capability Narrowing: Permission & Role Subsetting
  // =========================================================================
  {
    console.log('  - Test 10: Capability Narrowing Permission & Role Subsetting');
    const delegator = new SubAgentDelegator(runner);
    const parentContext: AgentContext = {
      sessionId: 'sess_perms_1',
      traceId: 'trace_parent_p',
      security: {
        userId: 'usr_admin',
        tenantId: 'tenant_alpha',
        roles: ['admin', 'billing_manager', 'editor'],
        permissions: ['read:all', 'write:all', 'delete:all', 'billing:charge'],
      },
    };

    // Delegate with narrowed permissions and attempted privilege escalation
    await delegator.delegate(parentContext, {
      agentName: 'sub_agent_a',
      message: 'Perform SubTask A',
      narrowing: {
        allowedPermissions: ['read:all', 'system:superadmin'], // system:superadmin is not in parent
        allowedRoles: ['editor', 'cluster_root'], // cluster_root is not in parent
      },
    });

    const subContext = capturedContexts[capturedContexts.length - 1];
    // Sub-agent receives intersection only (no escalation)
    assert(
      JSON.stringify(subContext.security.permissions) === JSON.stringify(['read:all']),
      `Permissions narrowed without escalation: ${JSON.stringify(subContext.security.permissions)}`,
    );
    assert(
      JSON.stringify(subContext.security.roles) === JSON.stringify(['editor']),
      `Roles narrowed without escalation: ${JSON.stringify(subContext.security.roles)}`,
    );
    console.log('    ✓ Permission & role least-privilege narrowing verified');
  }

  // =========================================================================
  // TEST 11: Distributed Trace Propagation Hierarchy
  // =========================================================================
  {
    console.log('  - Test 11: Distributed Trace Propagation Hierarchy');
    const delegator = new SubAgentDelegator(runner);
    const parentContext: AgentContext = {
      sessionId: 'sess_trace_root',
      traceId: 'parent_turn_trace_999',
      rootTraceId: 'root_workflow_trace_111',
      security: { tenantId: 'tenant_beta' },
    };

    await delegator.delegate(parentContext, {
      agentName: 'sub_agent_a',
      message: 'Perform SubTask A',
    });

    const subContext = capturedContexts[capturedContexts.length - 1];
    assert(subContext.parentTraceId === 'parent_turn_trace_999', 'parentTraceId matches parent trace');
    assert(subContext.rootTraceId === 'root_workflow_trace_111', 'rootTraceId matches root trace');
    console.log('    ✓ Distributed trace propagation verified');
  }

  // =========================================================================
  // TEST 12: Max Delegation Depth Recursion Guard
  // =========================================================================
  {
    console.log('  - Test 12: Max Delegation Depth Recursion Guard');
    const delegator = new SubAgentDelegator(runner, { maxDelegationDepth: 2 });

    const parentContext: AgentContext = {
      sessionId: 'sess_depth_1',
      traceId: 'trace_depth',
      security: { tenantId: 'tenant_gamma' },
      data: { __delegationDepth: 2 }, // Already at depth 2
    };

    let depthExceeded = false;
    try {
      await delegator.delegate(parentContext, {
        agentName: 'sub_agent_a',
        message: 'Perform SubTask A',
      });
    } catch (err) {
      if (err instanceof MaxDelegationDepthExceededError) {
        depthExceeded = true;
        assert(err.currentDepth === 3, 'currentDepth is 3');
        assert(err.maxDepth === 2, 'maxDepth is 2');
      }
    }

    assert(depthExceeded, 'MaxDelegationDepthExceededError thrown when recursion depth exceeded');
    console.log('    ✓ Delegation depth recursion guard verified');
  }

  console.log('🎉 All Orchestration Unit & Security Tests Passed!\n');
}

if (require.main === module) {
  runOrchestrationTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
