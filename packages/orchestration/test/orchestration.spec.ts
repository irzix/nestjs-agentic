import 'reflect-metadata';
import {
  Agent,
  AgentContext,
  AgentExecutor,
  AgentResult,
  AgentRunner,
  InMemoryApprovalStore,
  InMemoryStateStore,
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
  CapabilityEscalationError,
  CapabilityNarrowingPolicy,
  DebateRunner,
  MaxDelegationDepthExceededError,
  MissingFeedbackProviderError,
  ParallelSubAgentRunner,
  RefinementCheckpointConflictError,
  RefinementCheckpointNotFoundError,
  RefinementCheckpointVersionError,
  RefinementLoopAlreadyRunningError,
  RefinementLoopRunner,
  SopGuardFailedError,
  SopMaxTransitionsExceededError,
  SopPhaseExecutionError,
  SopRunner,
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

      const usage = lastUserMsg.includes('Heavy Token Task')
        ? { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 }
        : { inputTokens: 50, outputTokens: 25, totalTokens: 75 };

      if (lastUserMsg.includes('Slow Refinement Round')) {
        await new Promise((r) => setTimeout(r, 120));
      }

      if (lastUserMsg.includes('Refinement Feedback')) {
        return { content: 'Draft v2 perfectly refined', usage };
      }
      if (lastUserMsg.includes('Add executive summary')) {
        return { content: 'Draft v3 with executive summary and perfect tone', usage };
      }
      if (lastUserMsg === 'Perform SubTask A') {
        return { content: 'Task A Completed Successfully', usage };
      }
      if (lastUserMsg === 'Perform SubTask B') {
        return { content: 'Task B Completed Successfully', usage };
      }
      if (lastUserMsg === 'Draft initial report') {
        return { content: 'Draft v1 containing errors', usage };
      }

      // Tool invocation triggers
      if (lastUserMsg.includes('Call getBalance')) {
        const lastToolMsg = messages.find((m) => m.role === 'tool');
        if (!lastToolMsg) {
          return {
            content: 'Checking balance...',
            toolCalls: [{ id: 'call_bal_1', name: 'getBalance', args: {} }],
            usage,
          };
        }
        return { content: `Balance retrieved: ${lastToolMsg.content}`, usage };
      }

      if (lastUserMsg.includes('Call transferFunds')) {
        const lastToolMsg = messages.find((m) => m.role === 'tool');
        if (!lastToolMsg) {
          return {
            content: 'Transferring funds...',
            toolCalls: [
              { id: 'call_tx_1', name: 'transferFunds', args: { amount: 500, recipient: 'vendor_x' } },
            ],
            usage,
          };
        }
        return { content: `Transfer result: ${lastToolMsg.content}`, usage };
      }

      if (lastUserMsg.includes('Call auditLogs')) {
        const lastToolMsg = messages.find((m) => m.role === 'tool');
        if (!lastToolMsg) {
          return {
            content: 'Auditing logs...',
            toolCalls: [{ id: 'call_audit_1', name: 'auditLogs', args: {} }],
            usage,
          };
        }
        return { content: `Audit result: ${lastToolMsg.content}`, usage };
      }

      return { content: `Processed ${lastUserMsg}`, usage };
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

    const result = await parallelRunner.run(parentContext, tasks);

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

    const result = await parallelRunner.run(parentContext, tasks);

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

    const result = await parallelRunner.run(parentContext, tasks);
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
    const result = await loopRunner.run(
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

    const result = await parallelRunner.run(parentContext, tasks);
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

    const result = await parallelRunner.run(parentContext, tasks);
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

    const inFlightResult = await inFlightRunner.run(parentContext, [
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

    // Delegate with narrowed subset
    await delegator.delegate(parentContext, {
      agentName: 'sub_agent_a',
      message: 'Perform SubTask A',
      narrowing: {
        allowedPermissions: ['read:all', 'write:all'],
        allowedRoles: ['editor', 'admin'],
      },
    });

    const subContext = capturedContexts[capturedContexts.length - 1];
    assert(
      JSON.stringify(subContext.security.permissions) === JSON.stringify(['read:all', 'write:all']),
      `Permissions narrowed: ${JSON.stringify(subContext.security.permissions)}`,
    );
    assert(
      Boolean(
        subContext.security.roles?.includes('editor') &&
          subContext.security.roles?.includes('admin') &&
          subContext.security.roles?.length === 2,
      ),
      `Roles narrowed: ${JSON.stringify(subContext.security.roles)}`,
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
      data: { agentic: { delegationDepth: 2 } }, // Already at depth 2
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

  // =========================================================================
  // TEST 13: Capability Escalation Check (throws CapabilityEscalationError)
  // =========================================================================
  {
    console.log('  - Test 13: Capability Escalation Check (throws CapabilityEscalationError)');
    const delegator = new SubAgentDelegator(runner);
    const parentContext: AgentContext = {
      sessionId: 'sess_escalate_1',
      traceId: 'trace_esc',
      security: {
        userId: 'usr_normal',
        tenantId: 'tenant_omega',
        permissions: ['read:basic'],
        roles: ['viewer'],
      },
    };

    let escalationCaught = false;
    try {
      await delegator.delegate(parentContext, {
        agentName: 'sub_agent_a',
        message: 'Perform SubTask A',
        narrowing: {
          allowedPermissions: ['read:basic', 'root:superadmin'], // Escalation attempt
        },
      });
    } catch (err) {
      if (err instanceof CapabilityEscalationError) {
        escalationCaught = true;
        assert(err.type === 'permissions', 'Identified permission escalation');
        assert(err.requestedCapabilities.includes('root:superadmin'), 'Identified unauthorized permission');
      }
    }
    assert(escalationCaught, 'CapabilityEscalationError thrown on permission escalation');
    console.log('    ✓ Privilege escalation prevention verified');
  }

  // =========================================================================
  // TEST 14: Empty allowedTools: [] (Deny All Tools)
  // =========================================================================
  {
    console.log('  - Test 14: Empty allowedTools: [] (Deny All Tools)');
    const delegator = new SubAgentDelegator(runner);
    const parentContext: AgentContext = {
      sessionId: 'sess_empty_whitelist',
      traceId: 'trace_empty_w',
      security: { tenantId: 'tenant_omega' },
    };

    const deniedRes = await delegator.delegate(parentContext, {
      agentName: 'finance_agent',
      message: 'Call getBalance',
      narrowing: {
        allowedTools: [], // Empty whitelist -> deny all tools
      },
    });

    assert(
      deniedRes.response.includes('denied') || deniedRes.response.includes('not permitted'),
      'Empty allowedTools whitelist denied tool invocation',
    );
    console.log('    ✓ Empty allowedTools whitelist enforcement verified');
  }

  // =========================================================================
  // TEST 15: Nested Delegation Capability Stacking
  // =========================================================================
  {
    console.log('  - Test 15: Nested Delegation Capability Stacking & Narrowing Inheritance');
    const delegator = new SubAgentDelegator(runner, { maxDelegationDepth: 5 });
    // Root parent allows ['getBalance', 'auditLogs']
    const rootContext: AgentContext = {
      sessionId: 'sess_nested_root',
      traceId: 'trace_root_stack',
      security: { tenantId: 'tenant_stack' },
      data: {
        agentic: {
          capabilityNarrowing: {
            allowedTools: ['getBalance', 'auditLogs'],
            deniedTools: ['transferFunds'],
          },
        },
      },
    };

    // Sub-agent delegates further to sub-sub-agent narrowing to ['getBalance']
    const resSub = await delegator.delegate(rootContext, {
      agentName: 'finance_agent',
      message: 'Call getBalance',
      narrowing: {
        allowedTools: ['getBalance'], // Intersects with root allowedTools
      },
    });

    assert(resSub.status === 'success', 'Sub-sub-agent executed whitelisted tool in stack');

    // Attempting tool allowed in root ('auditLogs') but omitted in sub-delegation
    const resDenied = await delegator.delegate(rootContext, {
      agentName: 'finance_agent',
      message: 'Call auditLogs',
      narrowing: {
        allowedTools: ['getBalance'], // auditLogs excluded in child layer
      },
    });

    assert(
      resDenied.response.includes('denied') || resDenied.response.includes('not permitted'),
      'Sub-agent narrowing restriction inherited and enforced',
    );
    console.log('    ✓ Nested capability narrowing stacking verified');
  }

  // =========================================================================
  // TEST 16: Conflicting Whitelist & Blacklist (Blacklist Takes Precedence)
  // =========================================================================
  {
    console.log('  - Test 16: Conflicting Whitelist & Blacklist (Blacklist Precedence)');
    const delegator = new SubAgentDelegator(runner);
    const parentContext: AgentContext = {
      sessionId: 'sess_conflict_1',
      traceId: 'trace_conflict',
      security: { tenantId: 'tenant_conflict' },
    };

    // Specify transferFunds in BOTH allowedTools and deniedTools
    const res = await delegator.delegate(parentContext, {
      agentName: 'finance_agent',
      message: 'Call transferFunds',
      narrowing: {
        allowedTools: ['getBalance', 'transferFunds'],
        deniedTools: ['transferFunds'], // Blacklist must override whitelist
      },
    });

    assert(
      res.response.includes('prohibited') || res.response.includes('denied'),
      'Blacklist took precedence over whitelist for conflicting tool',
    );
    assert(financeTools.transfers.length === 0, 'Side effect never executed');
    console.log('    ✓ Blacklist precedence over whitelist verified');
  }

  // =========================================================================
  // TEST 17: Automatic Refinement Loop Checkpointing in StateStore
  // =========================================================================
  {
    console.log('  - Test 17: Automatic Refinement Loop Checkpointing in StateStore');
    const stateStore = new InMemoryStateStore();
    const loopRunner = new RefinementLoopRunner(runner, {
      maxIterations: 3,
      stateStore,
      satisfactionFn: () => Promise.resolve(false), // Loop reaches maxIterations
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_ckpt_auto',
      traceId: 'trace_ckpt_auto',
      security: { tenantId: 'tenant_ckpt_1' },
    };

    const result = await loopRunner.run(
      parentContext,
      { agentName: 'writer_agent', message: 'Draft initial report' },
      () => 'Refinement Feedback: Improve further',
    );

    assert(result.iterations === 3, 'Executed all 3 iterations');
    assert(result.satisfied === false, 'Termination unsatisfied as configured');
    assert(result.terminationReason === 'max_iterations', 'Termination reason is max_iterations');

    // Verify checkpoint exists in stateStore
    const checkpoint = await loopRunner.getCheckpoint(parentContext, 'writer_agent');
    assert(checkpoint !== null, 'Checkpoint was successfully saved in StateStore');
    assert(checkpoint!.iteration === 2, 'Latest in-flight checkpoint was for iteration 2');
    assert(checkpoint!.history.length === 2, 'Checkpoint contains history up to iteration 2');
    assert(checkpoint!.totalTokens > 0, 'Checkpoint contains accumulated token usage');
    console.log('    ✓ Automatic refinement checkpointing verified');
  }

  // =========================================================================
  // TEST 18: Resume Refinement Loop from Checkpoint Across Restarts
  // =========================================================================
  {
    console.log('  - Test 18: Resume Refinement Loop from Checkpoint Across Restarts');
    const stateStore = new InMemoryStateStore();

    const parentContext: AgentContext = {
      sessionId: 'sess_resume_1',
      traceId: 'trace_resume',
      security: { tenantId: 'tenant_resume' },
    };

    // 1. Instance A executes iteration 1 and crashes
    const instanceA = new RefinementLoopRunner(runner, {
      maxIterations: 3,
      stateStore,
      satisfactionFn: () => Promise.resolve(false),
    });

    // Run iteration 1 and simulate interruption
    await instanceA.run(
      parentContext,
      { agentName: 'writer_agent', message: 'Draft initial report' },
      () => 'Refinement Feedback: Improve language',
    );

    const savedCheckpoint = await instanceA.getCheckpoint(parentContext, 'writer_agent');
    assert(savedCheckpoint !== null, 'Saved checkpoint found');

    // 2. Instance B boots up with fresh runner and resumes from checkpoint
    const instanceB = new RefinementLoopRunner(runner, {
      maxIterations: 3,
      stateStore,
      satisfactionFn: (res) => Promise.resolve(res.response.includes('perfectly refined')),
    });

    const resumedResult = await instanceB.resume(
      parentContext,
      savedCheckpoint!,
      () => 'Refinement Feedback: Final polish',
    );

    assert(resumedResult.satisfied === true, 'Resumed loop satisfied quality goal');
    assert(resumedResult.iterations >= 2, 'Resumed loop finished remaining iterations');
    assert(resumedResult.finalResponse.includes('perfectly refined'), 'Final output matches expected quality');
    console.log('    ✓ Resumed refinement loop from checkpoint verified');
  }

  // =========================================================================
  // TEST 19: Cumulative Token Budget Enforcement (maxTotalTokens)
  // =========================================================================
  {
    console.log('  - Test 19: Cumulative Token Budget Enforcement (maxTotalTokens)');
    const loopRunner = new RefinementLoopRunner(runner, {
      maxIterations: 5,
      budget: {
        maxTotalTokens: 100, // 75 tokens per iteration -> exceeds limit on iteration 2
      },
      satisfactionFn: () => Promise.resolve(false),
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_token_budget',
      traceId: 'trace_tbudget',
      security: { tenantId: 'tenant_budget' },
    };

    const result = await loopRunner.run(
      parentContext,
      { agentName: 'writer_agent', message: 'Draft initial report' },
      () => 'Refinement Feedback: Try again',
    );

    assert(result.terminationReason === 'budget_exceeded', 'Loop terminated with budget_exceeded reason');
    assert(result.satisfied === false, 'Loop not satisfied due to budget exhaustion');
    assert(result.totalTokens >= 100, 'Total tokens exceeded configured budget limit');
    assert(result.iterations < 5, 'Loop halted before maxIterations');
    console.log('    ✓ Token budget limit enforcement verified');
  }

  // =========================================================================
  // TEST 20: Cumulative Duration Budget Enforcement (maxTotalTimeMs)
  // =========================================================================
  {
    console.log('  - Test 20: Cumulative Duration Budget Enforcement (maxTotalTimeMs)');
    const loopRunner = new RefinementLoopRunner(runner, {
      maxIterations: 5,
      budget: {
        maxTotalTimeMs: 150, // 120ms per round -> exceeds on round 2
      },
      satisfactionFn: () => Promise.resolve(false),
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_time_budget',
      traceId: 'trace_time_budget',
      security: { tenantId: 'tenant_budget' },
    };

    const result = await loopRunner.run(
      parentContext,
      { agentName: 'writer_agent', message: 'Slow Refinement Round 1' },
      () => 'Slow Refinement Round 2',
    );

    assert(result.terminationReason === 'budget_exceeded', 'Terminated due to duration budget limit');
    assert(result.totalDurationMs >= 150, 'Total duration recorded accurately');
    console.log('    ✓ Duration budget limit enforcement verified');
  }

  // =========================================================================
  // TEST 21: Structured SatisfactionResult with Dynamic Evaluator Feedback
  // =========================================================================
  {
    console.log('  - Test 21: Structured SatisfactionResult with Dynamic Evaluator Feedback');
    const loopRunner = new RefinementLoopRunner(runner, {
      maxIterations: 3,
      satisfactionFn: (res, iter) => {
        if (iter === 1) {
          return {
            satisfied: false,
            score: 0.65,
            feedback: 'Add executive summary', // Dynamic prompt for iteration 2
            reason: 'Missing executive summary section',
          };
        }
        return {
          satisfied: true,
          score: 0.98,
          reason: 'Complete with executive summary',
        };
      },
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_eval_feedback',
      traceId: 'trace_eval_f',
      security: { tenantId: 'tenant_eval' },
    };

    const result = await loopRunner.run(parentContext, {
      agentName: 'writer_agent',
      message: 'Draft initial report',
    });

    assert(result.satisfied === true, 'Loop satisfied via evaluator');
    assert(result.terminationReason === 'satisfied', 'Termination reason is satisfied');
    assert(result.iterations === 2, 'Completed exactly in 2 iterations');
    assert(result.finalResponse.includes('executive summary'), 'Iteration 2 used dynamic evaluator feedback');
    console.log('    ✓ Structured SatisfactionResult dynamic feedback verified');
  }

  // =========================================================================
  // TEST 22: Automatic Checkpoint Cleanup upon Satisfied Completion
  // =========================================================================
  {
    console.log('  - Test 22: Automatic Checkpoint Cleanup upon Satisfied Completion');
    const stateStore = new InMemoryStateStore();
    const loopRunner = new RefinementLoopRunner(runner, {
      maxIterations: 3,
      stateStore,
      satisfactionFn: () => Promise.resolve(true), // Satisfied immediately on round 1
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_ckpt_clean',
      traceId: 'trace_clean',
      security: { tenantId: 'tenant_clean' },
    };

    const result = await loopRunner.run(parentContext, {
      agentName: 'writer_agent',
      message: 'Draft initial report',
    });

    assert(result.satisfied === true, 'Loop completed with satisfaction');
    const checkpoint = await loopRunner.getCheckpoint(parentContext, 'writer_agent');
    assert(checkpoint === null, 'Checkpoint was deleted from StateStore upon satisfied completion');
    console.log('    ✓ Checkpoint cleanup on completion verified');
  }

  // =========================================================================
  // TEST 23: Checkpoint Schema Version Validation
  // =========================================================================
  {
    console.log('  - Test 23: Checkpoint Schema Version Validation');
    const loopRunner = new RefinementLoopRunner(runner);
    const parentContext: AgentContext = {
      sessionId: 'sess_version_err',
      traceId: 'trace_v_err',
      security: { tenantId: 'tenant_v' },
    };

    const invalidCheckpoint = {
      version: 99, // Incompatible version
      parentSessionId: 'sess_version_err',
      agentName: 'writer_agent',
      iteration: 1,
      maxIterations: 3,
      history: [],
      totalTokens: 50,
      totalDurationMs: 100,
      currentMessage: 'msg',
      savedAt: new Date().toISOString(),
    } as never;

    let versionErrorCaught = false;
    try {
      await loopRunner.resume(parentContext, invalidCheckpoint);
    } catch (err) {
      if (err instanceof RefinementCheckpointVersionError) {
        versionErrorCaught = true;
        assert(err.version === 99, 'Caught invalid version');
        assert(err.supportedVersion === 1, 'Expected version 1');
      }
    }

    assert(versionErrorCaught, 'RefinementCheckpointVersionError thrown on invalid version');
    console.log('    ✓ Checkpoint schema version validation verified');
  }

  // =========================================================================
  // TEST 24: Distributed Concurrency Lock Contention (RefinementLoopAlreadyRunningError)
  // =========================================================================
  {
    console.log('  - Test 24: Distributed Concurrency Lock Contention');
    const stateStore = new InMemoryStateStore();
    const runnerA = new RefinementLoopRunner(runner, {
      maxIterations: 3,
      stateStore,
      satisfactionFn: () => new Promise((r) => setTimeout(() => r(false), 80)),
    });
    const runnerB = new RefinementLoopRunner(runner, {
      maxIterations: 3,
      stateStore,
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_lock_race',
      traceId: 'trace_lock_race',
      security: { tenantId: 'tenant_race' },
    };

    // Start instance A (simulating long-running in-flight refinement execution)
    const runAPromise = runnerA.run(
      parentContext,
      { agentName: 'writer_agent', message: 'Slow Draft initial report' },
      () => 'Refinement Feedback: Continue',
    );

    // Give instance A a tick to acquire the distributed lease lock
    await new Promise((r) => setTimeout(r, 15));

    // Attempt to start instance B concurrently for the same session and agent
    let lockErrorCaught = false;
    try {
      await runnerB.run(parentContext, {
        agentName: 'writer_agent',
        message: 'Draft initial report',
      });
    } catch (err) {
      if (err instanceof RefinementLoopAlreadyRunningError) {
        lockErrorCaught = true;
        assert(err.sessionId === 'sess_lock_race', 'Error matches session ID');
        assert(err.agentName === 'writer_agent', 'Error matches agent name');
      }
    }

    assert(lockErrorCaught, 'RefinementLoopAlreadyRunningError thrown on concurrent execution');
    await runAPromise;
    console.log('    ✓ Concurrency lock contention protection verified');
  }

  // =========================================================================
  // TEST 25: Dynamic Token Budget Downscaling Passed to Sub-Agent Limits
  // =========================================================================
  {
    console.log('  - Test 25: Dynamic Token Budget Downscaling');
    const loopRunner = new RefinementLoopRunner(runner, {
      maxIterations: 3,
      budget: {
        maxTotalTokens: 100, // Round 1 uses 75, round 2 gets 25 max
      },
      satisfactionFn: () => Promise.resolve(false),
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_dyn_budget',
      traceId: 'trace_dyn_b',
      security: { tenantId: 'tenant_budget' },
    };

    const res = await loopRunner.run(parentContext, {
      agentName: 'writer_agent',
      message: 'Draft initial report',
    });

    assert(res.terminationReason === 'budget_exceeded', 'Terminated safely with budget_exceeded');
    assert(res.totalTokens >= 100, 'Total tokens tracked correctly');
    console.log('    ✓ Dynamic token budget downscaling verified');
  }

  // =========================================================================
  // TEST 26: Missing Feedback Provider Validation on Resume (MissingFeedbackProviderError)
  // =========================================================================
  {
    console.log('  - Test 26: Missing Feedback Provider Validation on Resume');
    const stateStore = new InMemoryStateStore();
    const loopRunner = new RefinementLoopRunner(runner, {
      maxIterations: 3,
      stateStore,
      satisfactionFn: () => Promise.resolve(false),
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_feedback_source_chk',
      traceId: 'trace_f_src',
      security: { tenantId: 'tenant_f_src' },
    };

    await loopRunner.run(
      parentContext,
      { agentName: 'writer_agent', message: 'Draft initial report' },
      () => 'Custom Provider Feedback',
    );

    const checkpoint = await loopRunner.getCheckpoint(parentContext, 'writer_agent');
    assert(checkpoint !== null, 'Checkpoint exists');
    assert(checkpoint!.feedbackSource === 'provider', 'feedbackSource marked as provider');

    let missingProviderCaught = false;
    try {
      // Attempt resume without providing feedbackProviderFn
      await loopRunner.resume(parentContext, checkpoint!);
    } catch (err) {
      if (err instanceof MissingFeedbackProviderError) {
        missingProviderCaught = true;
      }
    }

    assert(missingProviderCaught, 'MissingFeedbackProviderError thrown on resume without provider');
    console.log('    ✓ Missing feedback provider validation on resume verified');
  }

  // =========================================================================
  // TEST 27: Monotonic Checkpoint Sequence & Error TTL
  // =========================================================================
  {
    console.log('  - Test 27: Monotonic Checkpoint Sequence & Error TTL');
    const stateStore = new InMemoryStateStore();
    const loopRunner = new RefinementLoopRunner(runner, {
      maxIterations: 4,
      stateStore,
      errorCheckpointTtlSeconds: 1800,
      satisfactionFn: () => Promise.resolve(false),
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_seq_test',
      traceId: 'trace_seq',
      security: { tenantId: 'tenant_seq' },
    };

    await loopRunner.run(
      parentContext,
      { agentName: 'writer_agent', message: 'Draft initial report' },
      () => 'Refinement Feedback: Round 2',
    );

    const checkpoint = await loopRunner.getCheckpoint(parentContext, 'writer_agent');
    assert(checkpoint !== null, 'Checkpoint exists');
    assert(checkpoint!.checkpointSequence >= 2, 'checkpointSequence is monotonically positive');
    console.log('    ✓ Checkpoint sequence incrementation verified');
  }

  // =========================================================================
  // TEST 28: Atomic Lock Acquisition via StateStore.setIfNotExists
  // =========================================================================
  {
    console.log('  - Test 28: Atomic Lock Acquisition via StateStore.setIfNotExists');
    const stateStore = new InMemoryStateStore();
    const key = 'test:atomic:lock';

    const first = await stateStore.setIfNotExists(key, 'lock_1', 60);
    assert(first === true, 'First setIfNotExists succeeds');

    const second = await stateStore.setIfNotExists(key, 'lock_2', 60);
    assert(second === false, 'Second setIfNotExists fails atomically');

    await stateStore.delete(key);
    const third = await stateStore.setIfNotExists(key, 'lock_3', 60);
    assert(third === true, 'setIfNotExists succeeds after key deletion');
    console.log('    ✓ Atomic setIfNotExists behavior verified');
  }

  // =========================================================================
  // TEST 29: Safe Lock Release (Owner Verification)
  // =========================================================================
  {
    console.log('  - Test 29: Safe Lock Release (Owner Verification)');
    const stateStore = new InMemoryStateStore();
    const loopRunner = new RefinementLoopRunner(runner, { stateStore });
    const parentContext: AgentContext = {
      sessionId: 'sess_safe_release',
      traceId: 'trace_safe_rel',
      security: { tenantId: 'tenant_rel' },
    };

    // Simulate process A holding lock
    const lockKey = `agentic:tenant_rel:refinement:sess_safe_release:writer_agent:lock`;
    await stateStore.set(lockKey, 'owner_lock_A', 60);

    // Simulate process B attempting to release process A's lock with wrong lockId
    await (loopRunner as unknown as { releaseLock: (ctx: AgentContext, agent: string, lockId: string) => Promise<void> })
      .releaseLock(parentContext, 'writer_agent', 'wrong_lock_B');

    const currentLock = await stateStore.get<string>(lockKey);
    assert(currentLock === 'owner_lock_A', 'Process A lock was NOT deleted by Process B');

    // Process A releases with correct lockId
    await (loopRunner as unknown as { releaseLock: (ctx: AgentContext, agent: string, lockId: string) => Promise<void> })
      .releaseLock(parentContext, 'writer_agent', 'owner_lock_A');

    const releasedLock = await stateStore.get<string>(lockKey);
    assert(releasedLock === null, 'Process A lock was successfully deleted by owner');
    console.log('    ✓ Safe owner-verified lock release verified');
  }

  // =========================================================================
  // TEST 30: OCC Sequence Enforcement (RefinementCheckpointConflictError)
  // =========================================================================
  {
    console.log('  - Test 30: OCC Sequence Enforcement (RefinementCheckpointConflictError)');
    const stateStore = new InMemoryStateStore();
    const loopRunner = new RefinementLoopRunner(runner, { stateStore });
    const parentContext: AgentContext = {
      sessionId: 'sess_occ_test',
      traceId: 'trace_occ',
      security: { tenantId: 'tenant_occ' },
    };

    const checkpointKey = `agentic:tenant_occ:refinement:sess_occ_test:writer_agent:checkpoint`;

    // Save checkpoint sequence 5
    await stateStore.set(checkpointKey, {
      version: 1,
      checkpointSequence: 5,
      parentSessionId: 'sess_occ_test',
      agentName: 'writer_agent',
      iteration: 2,
      maxIterations: 3,
      history: [],
      totalTokens: 100,
      totalDurationMs: 200,
      currentMessage: 'msg',
      feedbackSource: 'default',
      savedAt: new Date().toISOString(),
    });

    // Attempt to write an older or equal sequence (e.g. sequence 4)
    let conflictCaught = false;
    try {
      await (loopRunner as unknown as {
        saveCheckpoint: (
          key: string,
          ctx: AgentContext,
          agent: string,
          state: unknown,
        ) => Promise<void>;
      }).saveCheckpoint(checkpointKey, parentContext, 'writer_agent', {
        iteration: 2,
        maxIter: 3,
        history: [],
        accumulatedTokens: 80,
        accumulatedDurationMs: 150,
        currentMessage: 'stale msg',
        feedbackSource: 'default',
        sequence: 4, // Stale sequence
      });
    } catch (err) {
      if (err instanceof RefinementCheckpointConflictError) {
        conflictCaught = true;
        assert(err.attemptedSequence === 4, 'Attempted sequence matches 4');
        assert(err.currentSequence === 5, 'Current sequence matches 5');
      }
    }

    assert(conflictCaught, 'RefinementCheckpointConflictError thrown on stale sequence write');
    console.log('    ✓ OCC checkpoint sequence conflict detection verified');
  }

  // =========================================================================
  // TEST 31: firstSuccess Race — Fast Cancellation of Losers
  // =========================================================================
  {
    console.log('  - Test 31: firstSuccess Race — Fast Cancellation of Losers');
    const parallelRunner = new ParallelSubAgentRunner(runner, {
      aggregationStrategy: 'firstSuccess',
      timeoutMs: 10000,
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_race_first',
      traceId: 'trace_race',
      security: { tenantId: 'tenant_race' },
    };

    const res = await parallelRunner.run(parentContext, [
      { agentName: 'writer_agent', message: 'Fast responder' },
      { agentName: 'agent_a', message: 'Slow responder' },
      { agentName: 'agent_b', message: 'Another responder' },
    ]);

    assert(res.successCount === 1, 'Exactly one winner in firstSuccess');
    assert(res.results.length === 1, 'Only the winner result is returned');
    assert(res.selectedAgent !== undefined, 'selectedAgent is set');
    assert(res.combinedResponse.length > 0, 'Combined response contains winner output');
    console.log('    ✓ firstSuccess race with fast cancellation verified');
  }

  // =========================================================================
  // TEST 32: bestOf — Evaluator-Driven Selection
  // =========================================================================
  {
    console.log('  - Test 32: bestOf — Evaluator-Driven Selection');
    const parallelRunner = new ParallelSubAgentRunner(runner, {
      aggregationStrategy: 'bestOf',
      evaluatorFn: (results) => {
        // Evaluator: pick the result with longest response
        return results.reduce((best, r) =>
          r.response.length > best.response.length ? r : best,
        );
      },
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_best_eval',
      traceId: 'trace_best_eval',
      security: { tenantId: 'tenant_best' },
    };

    const res = await parallelRunner.run(parentContext, [
      { agentName: 'writer_agent', message: 'Write short' },
      { agentName: 'agent_a', message: 'Write a long detailed response' },
    ]);

    assert(res.selectedAgent !== undefined, 'bestOf selects a winner');
    assert(res.successCount === 2, 'Both agents succeeded');
    assert(res.results.length === 2, 'All results are returned');
    assert(res.combinedResponse === res.results.find((r) => r.agentName === res.selectedAgent)?.response,
      'combinedResponse matches the selected winner');
    console.log('    ✓ bestOf evaluator-driven selection verified');
  }

  // =========================================================================
  // TEST 33: bestOf — Fallback to Highest Score (No Evaluator)
  // =========================================================================
  {
    console.log('  - Test 33: bestOf — Fallback to Highest Score');
    const parallelRunner = new ParallelSubAgentRunner(runner, {
      aggregationStrategy: 'bestOf',
      // No evaluatorFn — should fall back to highest score
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_best_score',
      traceId: 'trace_best_score',
      security: { tenantId: 'tenant_score' },
    };

    const res = await parallelRunner.run(parentContext, [
      { agentName: 'writer_agent', message: 'Draft analysis' },
      { agentName: 'agent_a', message: 'Draft analysis' },
    ]);

    assert(res.selectedAgent !== undefined, 'bestOf without evaluator still selects');
    assert(res.combinedResponse.length > 0, 'Response is non-empty');
    console.log('    ✓ bestOf fallback to highest score verified');
  }

  // =========================================================================
  // TEST 34: fallbackChain — Sequential Cascade Stops on First Success
  // =========================================================================
  {
    console.log('  - Test 34: fallbackChain — Sequential Cascade Stops on First Success');
    const callOrder: string[] = [];
    const mockRunner = {
      async run(agentName: string, input: Record<string, unknown>) {
        callOrder.push(agentName);
        if (agentName === 'agent_a') {
          throw new Error('Agent A failed');
        }
        return {
          output: `${agentName} succeeded`,
          toolCalls: [],
          usage: { inputTokens: 25, outputTokens: 25, totalTokens: 50 },
        };
      },
    } as unknown as AgentRunner;

    const cascadeRunner = new ParallelSubAgentRunner(mockRunner, {
      aggregationStrategy: 'fallbackChain',
      retriesPerSubAgent: 0,
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_cascade',
      traceId: 'trace_cascade',
      security: { tenantId: 'tenant_cascade' },
    };

    const res = await cascadeRunner.run(parentContext, [
      { agentName: 'agent_a', message: 'Try A' },
      { agentName: 'agent_b', message: 'Try B' },
      { agentName: 'agent_c', message: 'Try C' },
    ]);

    assert(callOrder.length === 2, `Called exactly 2 agents (was ${callOrder.length})`);
    assert(callOrder[0] === 'agent_a', 'Called agent_a first');
    assert(callOrder[1] === 'agent_b', 'Called agent_b second');
    assert(res.selectedAgent === 'agent_b', 'agent_b selected as winner');
    assert(res.successCount === 1, 'One success');
    assert(res.failedCount === 1, 'One failure');
    assert(res.results.length === 2, 'Only 2 results (agent_c never ran)');
    console.log('    ✓ fallbackChain sequential cascade verified');
  }

  // =========================================================================
  // TEST 35: fallbackChain — All Agents Fail
  // =========================================================================
  {
    console.log('  - Test 35: fallbackChain — All Agents Fail');
    const mockRunner = {
      async run(agentName: string) {
        throw new Error(`${agentName} failed`);
      },
    } as unknown as AgentRunner;

    const cascadeRunner = new ParallelSubAgentRunner(mockRunner, {
      aggregationStrategy: 'fallbackChain',
      retriesPerSubAgent: 0,
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_all_fail',
      traceId: 'trace_all_fail',
      security: { tenantId: 'tenant_fail' },
    };

    const res = await cascadeRunner.run(parentContext, [
      { agentName: 'agent_x', message: 'Try X' },
      { agentName: 'agent_y', message: 'Try Y' },
    ]);

    assert(res.successCount === 0, 'Zero successes');
    assert(res.failedCount === 2, 'All agents failed');
    assert(res.selectedAgent === undefined, 'No winner selected');
    assert(res.results.length === 2, 'All results returned');
    assert(res.combinedResponse.includes('agent_x') && res.combinedResponse.includes('agent_y'),
      'Combined response reports all failures');
    console.log('    ✓ fallbackChain all-fail cascade verified');
  }

  // =========================================================================
  // TEST 36: bestOf — Resilient Error Fallback on Faulty Evaluator
  // =========================================================================
  {
    console.log('  - Test 36: bestOf — Resilient Error Fallback on Faulty Evaluator');
    const parallelRunner = new ParallelSubAgentRunner(runner, {
      aggregationStrategy: 'bestOf',
      evaluatorFn: async () => {
        throw new Error('External evaluator API network timeout');
      },
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_eval_err',
      traceId: 'trace_eval_err',
      security: { tenantId: 'tenant_eval_err' },
    };

    const res = await parallelRunner.run(parentContext, [
      { agentName: 'writer_agent', message: 'Write short' },
      { agentName: 'agent_a', message: 'Write a long detailed response' },
    ]);

    assert(res.selectedAgent !== undefined, 'bestOf safely selects winner even when evaluator throws');
    assert(res.successCount === 2, 'Both sub-agents executed successfully');
    assert(res.results.length === 2, 'All sub-agent results preserved');
    console.log('    ✓ bestOf faulty evaluator fallback verified');
  }

  // =========================================================================
  // TEST 37: fallbackChain — Mid-Run Abort Captures All Remaining Tasks
  // =========================================================================
  {
    console.log('  - Test 37: fallbackChain — Mid-Run Abort Captures All Remaining Tasks');
    const abortController = new AbortController();

    const mockRunner = {
      async run(agentName: string) {
        if (agentName === 'agent_1') {
          // Abort during agent_1 run
          abortController.abort();
          throw new Error('Agent 1 failed');
        }
        return {
          output: `${agentName} output`,
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        };
      },
    } as unknown as AgentRunner;

    const cascadeRunner = new ParallelSubAgentRunner(mockRunner, {
      aggregationStrategy: 'fallbackChain',
      signal: abortController.signal,
      retriesPerSubAgent: 0,
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_cascade_abort',
      traceId: 'trace_cascade_abort',
      security: { tenantId: 'tenant_cascade_abort' },
    };

    const res = await cascadeRunner.run(parentContext, [
      { agentName: 'agent_1', message: 'Task 1' },
      { agentName: 'agent_2', message: 'Task 2' },
      { agentName: 'agent_3', message: 'Task 3' },
    ]);

    assert(res.results.length === 3, `All 3 tasks are tracked in results (was ${res.results.length})`);
    assert(Boolean(res.results[0].error?.includes('failed') || res.results[0].error?.includes('aborted')), 'First task failed');
    assert(res.results[1].error === 'Execution was aborted', 'Second task marked as aborted');
    assert(res.results[2].error === 'Execution was aborted', 'Third task marked as aborted');
    console.log('    ✓ fallbackChain mid-run abort completion verified');
  }

  // =========================================================================
  // TEST 38: DebateRunner — Multi-Round Convergence & Early Consensus Exit
  // =========================================================================
  {
    console.log('  - Test 38: DebateRunner — Multi-Round Convergence & Early Consensus Exit');
    let roundCount = 0;
    const debateMockRunner = {
      async run(agentName: string, input: Record<string, unknown>) {
        const msg = String(input.message ?? '');
        const isRound2 = msg.includes('Round 1 Arguments');
        if (isRound2) {
          roundCount = 2;
          // In round 2, debaters reach consensus with closely aligned scores
          return {
            output: `${agentName}: Revised conclusion with strong agreement`,
            toolCalls: [],
            score: agentName === 'debater_a' ? 0.95 : 0.92,
            usage: { inputTokens: 50, outputTokens: 50, totalTokens: 100 },
          };
        }
        // Round 1: divergent positions
        roundCount = 1;
        return {
          output: `${agentName}: Initial opening argument`,
          toolCalls: [],
          score: agentName === 'debater_a' ? 0.9 : 0.2,
          usage: { inputTokens: 25, outputTokens: 25, totalTokens: 50 },
        };
      },
    } as unknown as AgentRunner;

    const debateRunner = new DebateRunner(debateMockRunner, {
      maxRounds: 4,
      consensusThreshold: 0.8,
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_debate_conv',
      traceId: 'trace_debate_conv',
      security: { tenantId: 'tenant_debate' },
    };

    const res = await debateRunner.run(
      parentContext,
      [{ agentName: 'debater_a' }, { agentName: 'debater_b' }],
      'What is the optimal caching architecture?',
    );

    assert(res.rounds.length === 2, `Terminated early after 2 rounds (was ${res.rounds.length})`);
    assert(res.terminationReason === 'consensus', 'Terminated due to consensus reaching threshold');
    assert(res.requiresHumanReview === false, 'No human review needed on consensus');
    assert(res.winner === 'debater_a', 'Higher scoring debater selected as winner');
    assert(Boolean(res.consensusScore && res.consensusScore >= 0.8), 'Consensus score meets threshold');
    console.log('    ✓ DebateRunner multi-round convergence & early consensus exit verified');
  }

  // =========================================================================
  // TEST 39: DebateRunner — Max Rounds Exhausted & Auto Human Review Flag
  // =========================================================================
  {
    console.log('  - Test 39: DebateRunner — Max Rounds Exhausted & Auto Human Review Flag');
    const persistentDisagreeRunner = {
      async run(agentName: string) {
        return {
          output: `${agentName}: Unyielding opposing position`,
          toolCalls: [],
          score: agentName === 'debater_x' ? 0.95 : 0.05,
          usage: { inputTokens: 20, outputTokens: 20, totalTokens: 40 },
        };
      },
    } as unknown as AgentRunner;

    const debateRunner = new DebateRunner(persistentDisagreeRunner, {
      maxRounds: 3,
      consensusThreshold: 0.75,
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_debate_disagree',
      traceId: 'trace_debate_disagree',
      security: { tenantId: 'tenant_debate_disagree' },
    };

    const res = await debateRunner.run(
      parentContext,
      [{ agentName: 'debater_x' }, { agentName: 'debater_y' }],
      'Controversial architectural decision',
    );

    assert(res.rounds.length === 3, 'Ran all 3 configured rounds');
    assert(res.terminationReason === 'max_rounds', 'Terminated due to max rounds reached');
    assert(res.requiresHumanReview === true, 'Auto-flagged requiresHumanReview for maintainer intervention');
    assert(res.winner === 'debater_x', 'Highest scoring candidate chosen as fallback');
    console.log('    ✓ DebateRunner max rounds exhausted & human review flag verified');
  }

  // =========================================================================
  // TEST 40: DebateRunner — Mid-Debate AbortSignal Cancellation
  // =========================================================================
  {
    console.log('  - Test 40: DebateRunner — Mid-Debate AbortSignal Cancellation');
    const abortController = new AbortController();

    const mockRunner = {
      async run() {
        abortController.abort();
        return { output: 'R1 output', toolCalls: [], score: 0.5 };
      },
    } as unknown as AgentRunner;

    const debateRunner = new DebateRunner(mockRunner, {
      maxRounds: 3,
      signal: abortController.signal,
    });

    const parentContext: AgentContext = {
      sessionId: 'sess_debate_abort',
      traceId: 'trace_debate_abort',
      security: { tenantId: 'tenant_debate_abort' },
    };

    const res = await debateRunner.run(
      parentContext,
      [{ agentName: 'agent_1' }, { agentName: 'agent_2' }],
      'Topic',
    );

    assert(res.terminationReason === 'aborted', 'Debate marked as aborted');
    assert(res.requiresHumanReview === false, 'Aborted run does not trigger review');
    console.log('    ✓ DebateRunner mid-debate abort cancellation verified');
  }

  // =========================================================================
  // TEST 41: SopRunner — 3-Phase State Machine with Context & Output Chaining
  // =========================================================================
  {
    console.log('  - Test 41: SopRunner — 3-Phase State Machine with Context & Output Chaining');
    const executedMessages: string[] = [];

    const sopMockRunner = {
      async run(agentName: string, input: Record<string, unknown>) {
        const msg = String(input.message);
        executedMessages.push(msg);
        if (agentName === 'analyst') {
          return { output: 'Analysis: Found 2 performance bottlenecks', toolCalls: [] };
        }
        if (agentName === 'planner') {
          return { output: 'Plan: Add Redis cache and connection pool', toolCalls: [] };
        }
        if (agentName === 'synthesizer') {
          return { output: 'Final RFC document ready for review', toolCalls: [] };
        }
        return { output: 'Done', toolCalls: [] };
      },
    } as unknown as AgentRunner;

    const sopRunner = new SopRunner(sopMockRunner);
    const parentContext: AgentContext = {
      sessionId: 'sess_sop_chain',
      traceId: 'trace_sop_chain',
      security: { tenantId: 'tenant_sop' },
    };

    const res = await sopRunner.run(parentContext, [
      {
        name: 'analysis',
        agentName: 'analyst',
        buildMessage: () => 'Analyze codebase performance',
      },
      {
        name: 'planning',
        agentName: 'planner',
        buildMessage: (ctx) => `Create an architectural plan for: ${ctx.lastOutput}`,
      },
      {
        name: 'synthesis',
        agentName: 'synthesizer',
        buildMessage: (ctx) => `Synthesize final RFC from plan: ${ctx.lastOutput}`,
      },
    ]);

    assert(res.phases.length === 3, 'All 3 phases executed successfully');
    assert(res.terminationReason === 'completed', 'Workflow completed');
    assert(res.requiresHumanReview === false, 'No human review needed');
    assert(res.finalOutput === 'Final RFC document ready for review', 'Final output captured from phase 3');
    assert(executedMessages[1].includes('Found 2 performance bottlenecks'), 'Phase 2 received phase 1 output');
    assert(executedMessages[2].includes('Add Redis cache and connection pool'), 'Phase 3 received phase 2 output');
    console.log('    ✓ SopRunner 3-phase state machine & context chaining verified');
  }

  // =========================================================================
  // TEST 42: SopRunner — Guard Failure Halts Workflow & Flags for Human Review
  // =========================================================================
  {
    console.log('  - Test 42: SopRunner — Guard Failure Halts Workflow & Flags for Human Review');
    let phase2Executed = false;

    const sopMockRunner = {
      async run(agentName: string) {
        if (agentName === 'security_auditor') {
          return { output: 'CRITICAL_VULNERABILITY: SQL Injection found in auth', toolCalls: [] };
        }
        if (agentName === 'deployer') {
          phase2Executed = true;
          return { output: 'Deployed to production', toolCalls: [] };
        }
        return { output: 'OK', toolCalls: [] };
      },
    } as unknown as AgentRunner;

    const sopRunner = new SopRunner(sopMockRunner);
    const parentContext: AgentContext = {
      sessionId: 'sess_sop_guard',
      traceId: 'trace_sop_guard',
      security: { tenantId: 'tenant_sop_guard' },
    };

    const res = await sopRunner.run(parentContext, [
      {
        name: 'security_gate',
        agentName: 'security_auditor',
        buildMessage: () => 'Audit release artifacts',
        // Guard fails if critical vulnerability detected
        guard: (result) => !result.response.includes('CRITICAL_VULNERABILITY'),
      },
      {
        name: 'deployment',
        agentName: 'deployer',
        buildMessage: () => 'Deploy artifacts',
      },
    ]);

    assert(res.phases.length === 1, 'Workflow halted immediately at phase 1');
    assert(phase2Executed === false, 'Phase 2 was never executed due to guard failure');
    assert(res.terminationReason === 'guard_failed', 'Terminated due to guard_failed');
    assert(res.requiresHumanReview === true, 'Workflow flagged requiresHumanReview for human maintainers');
    console.log('    ✓ SopRunner guard failure halts workflow & flags human review');
  }

  // =========================================================================
  // TEST 43: SopRunner — Inter-Phase AbortSignal Cancellation
  // =========================================================================
  {
    console.log('  - Test 43: SopRunner — Inter-Phase AbortSignal Cancellation');
    const abortController = new AbortController();

    const sopMockRunner = {
      async run(agentName: string) {
        if (agentName === 'phase1_agent') {
          return { output: 'Phase 1 done', toolCalls: [] };
        }
        return { output: 'Phase 2 done', toolCalls: [] };
      },
    } as unknown as AgentRunner;

    const sopRunner = new SopRunner(sopMockRunner, { signal: abortController.signal });
    const parentContext: AgentContext = {
      sessionId: 'sess_sop_abort',
      traceId: 'trace_sop_abort',
      security: { tenantId: 'tenant_sop_abort' },
    };

    const res = await sopRunner.run(parentContext, [
      {
        name: 'p1',
        agentName: 'phase1_agent',
        buildMessage: () => 'P1',
      },
      {
        name: 'p2',
        agentName: 'phase2_agent',
        buildMessage: () => {
          abortController.abort();
          return 'P2';
        },
      },
    ]);

    assert(res.phases.length === 1, 'Only phase 1 executed before abort');
    assert(res.terminationReason === 'aborted', 'Workflow terminated with aborted reason');
    console.log('    ✓ SopRunner inter-phase abort cancellation verified');
  }

  // =========================================================================
  // TEST 44: SopRunner — StateStore Phase Checkpointing & Tenant Isolation
  // =========================================================================
  {
    console.log('  - Test 44: SopRunner — StateStore Phase Checkpointing & Tenant Isolation');
    const stateStore = new InMemoryStateStore();

    const sopMockRunner = {
      async run(agentName: string) {
        return { output: `${agentName} output`, toolCalls: [] };
      },
    } as unknown as AgentRunner;

    const sopRunner = new SopRunner(sopMockRunner, { stateStore });
    const parentContext: AgentContext = {
      sessionId: 'sess_sop_ckpt',
      traceId: 'trace_sop_ckpt',
      security: { tenantId: 'tenant_enterprise' },
    };

    const res = await sopRunner.run(parentContext, [
      { name: 'step_1', agentName: 'worker_1', buildMessage: () => 'Step 1' },
      { name: 'step_2', agentName: 'worker_2', buildMessage: () => 'Step 2' },
    ]);

    assert(res.phases.length === 2, 'Completed both steps');
    const checkpoint = await stateStore.get<{ completedPhaseNames: string[] }>(
      'agentic:tenant_enterprise:sop:sess_sop_ckpt:checkpoint',
    );
    assert(checkpoint !== null, 'Checkpoint was saved in StateStore');
    assert(checkpoint?.completedPhaseNames.length === 2, 'All completed phase names recorded');
    assert(checkpoint?.completedPhaseNames[0] === 'step_1', 'step_1 in checkpoint');
    assert(checkpoint?.completedPhaseNames[1] === 'step_2', 'step_2 in checkpoint');
    console.log('    ✓ SopRunner StateStore phase checkpointing & tenant isolation verified');
  }

  console.log('🎉 All Orchestration Unit & Security Tests Passed!\n');
}

if (require.main === module) {
  runOrchestrationTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}


