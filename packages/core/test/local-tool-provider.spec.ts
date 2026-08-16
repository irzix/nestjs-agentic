import 'reflect-metadata';
import { ModuleRef } from '@nestjs/core';
import {
  ApprovalStore,
  Context,
  LocalToolProvider,
  Param,
  PolicyResult,
  Tool,
  ToolDiscoveryService,
  ToolPolicy,
  ToolSet,
  UsePolicies,
} from '../src';
import type { AgentContext, ToolExecutionResult } from '../src';
import { InMemoryApprovalStore } from '../src/stores/in-memory-approval.store';

// Dummy Policies for Testing Governance States
class AllowPolicy implements ToolPolicy {
  async evaluate(): Promise<PolicyResult> {
    return { decision: 'allow' };
  }
}

class DenyPolicy implements ToolPolicy {
  async evaluate(context: AgentContext): Promise<PolicyResult> {
    return { decision: 'deny', reason: `Access denied for tenant ${context.security.tenantId}` };
  }
}

class RequireApprovalPolicy implements ToolPolicy {
  async evaluate(): Promise<PolicyResult> {
    return { decision: 'require_approval', reason: 'High-risk action requires human approval' };
  }
}

// ToolSet with Policy Variations
@ToolSet({ name: 'governed-tools' })
class GovernedTools {
  @Tool({ description: 'Allowed action' })
  @UsePolicies(AllowPolicy)
  async safeAction(@Param('value') value: string, @Context() ctx: AgentContext) {
    return { status: 'processed', value, user: ctx.security.userId };
  }

  @Tool({ description: 'Restricted action' })
  @UsePolicies(DenyPolicy)
  async restrictedAction(@Param('amount') amount: number) {
    return { amount };
  }

  @Tool({ description: 'High risk action needing approval' })
  @UsePolicies(RequireApprovalPolicy)
  async highRiskAction(@Param('target') target: string) {
    return { executed: true, target };
  }
}

// Mock ModuleRef for Policy Resolution
class MockModuleRef {
  get(token: any): any {
    if (token === AllowPolicy) return new AllowPolicy();
    if (token === DenyPolicy) return new DenyPolicy();
    if (token === RequireApprovalPolicy) return new RequireApprovalPolicy();
    return undefined;
  }
}

export async function runLocalToolProviderTests() {
  console.log('🛡️ Running Step 2: LocalToolProvider & Governance Guard Unit Tests...\n');

  const discovery = new ToolDiscoveryService();
  const approvalStore = new InMemoryApprovalStore();
  const moduleRef = new MockModuleRef() as unknown as ModuleRef;

  const provider = new LocalToolProvider(
    [new AllowPolicy(), new DenyPolicy(), new RequireApprovalPolicy()],
    approvalStore,
    discovery,
    moduleRef,
  );

  const toolsInstance = new GovernedTools();
  const agentContext: AgentContext = {
    sessionId: 'test_session_123',
    traceId: 'trace_456',
    security: {
      userId: 'usr_admin',
      tenantId: 'tenant_acme',
      roles: ['admin'],
    },
  };

  const resolvedTools = provider.buildTools([toolsInstance], agentContext);
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

  // TEST 1: Tool Resolution Count
  try {
    assert(resolvedTools.length === 3, 'Test 1: Built 3 ResolvedTool closures');
  } catch (err: any) {
    assert(false, 'Test 1: Tool Resolution Count', err.message);
  }

  // TEST 2: Policy 'allow' & Context Parameter Injection
  try {
    const safeTool = resolvedTools.find((t) => t.name === 'safeAction');
    assert(safeTool !== undefined, 'Test 2a: safeAction tool closure resolved');

    const result = (await safeTool?.execute({ args: { value: 'hello' } })) as ToolExecutionResult;
    assert(result.success === true, 'Test 2b: Policy decision "allow" returns success: true');
    assert(
      (result as any).data?.user === 'usr_admin',
      'Test 2c: AgentContext pre-bound into @Context() parameter correctly',
    );
  } catch (err: any) {
    assert(false, 'Test 2: Policy allow & Context injection', err.message);
  }

  // TEST 3: Policy 'deny' Hashing & Reason
  try {
    const restrictedTool = resolvedTools.find((t) => t.name === 'restrictedAction');
    const result = (await restrictedTool?.execute({ args: { amount: 500 } })) as ToolExecutionResult;

    assert(result.success === false, 'Test 3a: Policy decision "deny" returns success: false');
    assert(
      !result.success && result.status === 'denied',
      'Test 3b: Status is "denied"',
    );
    assert(
      !result.success && result.reason.includes('tenant_acme'),
      'Test 3c: Policy evaluation reason contains context tenantId',
    );
  } catch (err: any) {
    assert(false, 'Test 3: Policy deny & Reason', err.message);
  }

  // TEST 4: Policy 'require_approval' & Store Execution
  try {
    const highRiskTool = resolvedTools.find((t) => t.name === 'highRiskAction');
    const result = (await highRiskTool?.execute({ args: { target: 'database_prod' } })) as ToolExecutionResult;

    assert(result.success === false, 'Test 4a: Policy "require_approval" returns success: false');
    assert(
      !result.success && result.status === 'pending_approval',
      'Test 4b: Status is "pending_approval"',
    );
    assert(
      !result.success && Boolean((result as any).approvalId),
      'Test 4c: Returns valid approvalId UUID',
    );

    if (!result.success && (result as any).approvalId) {
      const pendingRecord = await approvalStore.get((result as any).approvalId);
      assert(pendingRecord !== undefined, 'Test 4d: Pending approval record saved to ApprovalStore');
      assert(pendingRecord?.toolName === 'highRiskAction', 'Test 4e: Store record contains toolName');
      assert(
        typeof (pendingRecord as any)?.execute !== 'function',
        'Test 4f: Record is serializable data, not a live closure',
      );

      // Resolve the approved call directly, bypassing policy evaluation, the
      // same way ApprovalService resumes it.
      const executionRes = (await provider.invokeApprovedTool(
        [toolsInstance],
        pendingRecord!.toolName,
        pendingRecord!.args,
        pendingRecord!.context,
      )) as ToolExecutionResult;
      assert(
        executionRes?.success === true && (executionRes as any).data?.target === 'database_prod',
        'Test 4g: Saved record resolves and executes the method correctly upon human approval',
      );
    }
  } catch (err: any) {
    assert(false, 'Test 4: Policy require_approval & Store', err.message);
  }

  // TEST 5: Output Rails (evaluateOutput hook)
  try {
    class OutputSanitizingPolicy implements ToolPolicy {
      async evaluate(): Promise<PolicyResult> {
        return { decision: 'allow' };
      }

      async evaluateOutput(_ctx: AgentContext, _toolName: string, result: any) {
        if (result && typeof result === 'object' && result.rawSecret) {
          return {
            decision: 'sanitize' as const,
            sanitizedResult: { ...result, rawSecret: '[REDACTED]' },
          };
        }
        return { decision: 'allow' as const };
      }
    }

    @ToolSet({ name: 'output-rail-tools' })
    class OutputRailTools {
      @Tool({ description: 'Tool returning raw secrets' })
      @UsePolicies(OutputSanitizingPolicy)
      async getCredentials() {
        return { username: 'admin', rawSecret: 'super-secret-key-123' };
      }
    }

    const outputModuleRef = new MockModuleRef();
    const outputProvider = new LocalToolProvider(
      [new OutputSanitizingPolicy()],
      approvalStore,
      discovery,
      outputModuleRef as unknown as ModuleRef,
    );

    const tools = outputProvider.buildTools([new OutputRailTools()], agentContext, 'TestAgent');
    const credTool = tools.find((t) => t.name === 'getCredentials');
    const toolExecResult = await credTool?.execute({ args: {} });

    assert(toolExecResult?.success === true, 'Test 5a: Tool executes successfully');
    const data = (toolExecResult as any)?.data;
    assert(data?.username === 'admin', 'Test 5b: Non-secret field preserved');
    assert(data?.rawSecret === '[REDACTED]', 'Test 5c: Output rail policy sanitizes secret before returning');
  } catch (err: any) {
    assert(false, 'Test 5: Output Rails (evaluateOutput hook)', err.message);
  }

  // TEST 6: Tool Cancellation and Deadline Propagation
  try {
    const controller = new AbortController();
    const deadline = new Date(Date.now() + 5000);
    const cancellableContext: AgentContext = {
      ...agentContext,
      signal: controller.signal,
      deadline,
    };

    @ToolSet({ name: 'cancellable-tools' })
    class CancellableTools {
      @Tool({ description: 'Tool reading context signal and deadline' })
      async checkCancellation(@Context() ctx: AgentContext) {
        return {
          hasSignal: Boolean(ctx.signal),
          isAborted: ctx.signal?.aborted ?? false,
          hasDeadline: Boolean(ctx.deadline),
        };
      }
    }

    const cancelProvider = new LocalToolProvider(
      [],
      approvalStore,
      discovery,
      moduleRef as unknown as ModuleRef,
    );

    const tools = cancelProvider.buildTools([new CancellableTools()], cancellableContext, 'TestAgent');
    const tool = tools.find((t) => t.name === 'checkCancellation');

    const exec1 = await tool?.execute({ args: {} });
    assert(exec1?.success === true, 'Test 6a: Tool executed with context signal');
    assert((exec1 as any)?.data?.hasSignal === true, 'Test 6b: Context signal was propagated');
    assert((exec1 as any)?.data?.hasDeadline === true, 'Test 6c: Context deadline was propagated');

    // Abort controller
    controller.abort();
    const exec2 = await tool?.execute({ args: {} });
    assert(exec2?.success === false, 'Test 6d: Aborted signal blocked tool execution');
    assert((exec2 as any)?.status === 'denied', 'Test 6e: Aborted tool returns denied status');

    const approvedExec = await cancelProvider.invokeApprovedTool(
      [new CancellableTools()],
      'checkCancellation',
      {},
      cancellableContext,
    );
    assert(approvedExec.success === false, 'Test 6f: invokeApprovedTool respects aborted signal');
  } catch (err: any) {
    assert(false, 'Test 6: Tool Cancellation and Deadline Propagation', err.message);
  }

  console.log(`\n  📊 Step 2 Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Step 2 Unit Tests Failed');
  }
}

// Run directly if executed via node
if (require.main === module) {
  runLocalToolProviderTests().catch(() => process.exit(1));
}
