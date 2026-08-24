import 'reflect-metadata';
import { ModuleRef } from '@nestjs/core';
import {
  ApprovalStore,
  Context,
  InMemoryApprovalStore,
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
    const { ExecutionCancelledError, ExecutionLimitExceededError } = await import('../src');
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

      @Tool({ description: 'Long running async tool' })
      async longRunningTask(@Context() ctx: AgentContext) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve('completed'), 200);
          if (ctx.signal) {
            ctx.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new ExecutionCancelledError('Tool aborted in-flight'));
              },
              { once: true },
            );
          }
        });
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

    let abortedError: unknown;
    try {
      await tool?.execute({ args: {} });
    } catch (err) {
      abortedError = err;
    }
    assert(
      abortedError instanceof ExecutionCancelledError,
      'Test 6d: Aborted signal throws ExecutionCancelledError uniformly',
    );

    let approvedErr: unknown;
    try {
      await cancelProvider.invokeApprovedTool(
        [new CancellableTools()],
        'checkCancellation',
        {},
        cancellableContext,
      );
    } catch (err) {
      approvedErr = err;
    }
    assert(
      approvedErr instanceof ExecutionCancelledError,
      'Test 6e: invokeApprovedTool throws ExecutionCancelledError when aborted',
    );

    // Deadline expiry test
    const expiredContext: AgentContext = {
      ...agentContext,
      deadline: new Date(Date.now() - 1000), // In the past
    };
    const expiredTools = cancelProvider.buildTools([new CancellableTools()], expiredContext, 'TestAgent');
    let deadlineErr: unknown;
    try {
      await expiredTools[0]?.execute({ args: {} });
    } catch (err) {
      deadlineErr = err;
    }
    assert(
      deadlineErr instanceof ExecutionLimitExceededError,
      'Test 6f: Expired deadline throws ExecutionLimitExceededError',
    );

    // In-flight async tool cancellation test
    const inFlightCtrl = new AbortController();
    const inFlightCtx: AgentContext = {
      ...agentContext,
      signal: inFlightCtrl.signal,
    };
    const inFlightTools = cancelProvider.buildTools([new CancellableTools()], inFlightCtx, 'TestAgent');
    const longTool = inFlightTools.find((t) => t.name === 'longRunningTask');

    const longPromise = longTool?.execute({ args: {} });
    setTimeout(() => inFlightCtrl.abort(), 20);

    let inFlightErr: unknown;
    try {
      await longPromise;
    } catch (err) {
      inFlightErr = err;
    }
    assert(
      inFlightErr instanceof ExecutionCancelledError,
      'Test 6g: In-flight async tool aborts immediately on signal abort event',
    );
  } catch (err: any) {
    assert(false, 'Test 6: Tool Cancellation and Deadline Propagation', err.message);
  }

  // TEST 7: Output Rails run on the approval-resume path (invokeApprovedTool)
  //
  // Regression test for the bug where `invokeApprovedTool` executed the
  // approved method and returned its raw result without ever running
  // `evaluateOutput`, so a sensitive approved call's output skipped
  // sanitization entirely. Both the pre-execution `require_approval` chain
  // and the post-execution `evaluateOutput` chain must be exercised here.
  try {
    class ApprovalGatePolicy implements ToolPolicy {
      async evaluate(): Promise<PolicyResult> {
        return { decision: 'require_approval', reason: 'Sensitive credential fetch requires sign-off' };
      }
    }

    class RedactingOutputPolicy implements ToolPolicy {
      async evaluate(): Promise<PolicyResult> {
        return { decision: 'allow' };
      }

      async evaluateOutput(_ctx: AgentContext, _toolName: string, result: any) {
        if (result && typeof result === 'object' && result.apiKey) {
          return {
            decision: 'sanitize' as const,
            sanitizedResult: { ...result, apiKey: '[REDACTED_SECRET]' },
          };
        }
        return { decision: 'allow' as const };
      }
    }

    @ToolSet({ name: 'approved-output-rail-tools' })
    class ApprovedOutputRailTools {
      @Tool({ description: 'Fetches credentials, gated by approval, output redacted' })
      @UsePolicies(ApprovalGatePolicy, RedactingOutputPolicy)
      async fetchCredentials(@Param('service') service: string) {
        return { service, apiKey: 'sk-live-abcdef123456789' };
      }
    }

    class ApprovalOutputModuleRef {
      get(token: any): any {
        if (token === ApprovalGatePolicy) return new ApprovalGatePolicy();
        if (token === RedactingOutputPolicy) return new RedactingOutputPolicy();
        return undefined;
      }
    }

    const gatedProvider = new LocalToolProvider(
      [new ApprovalGatePolicy(), new RedactingOutputPolicy()],
      approvalStore,
      discovery,
      new ApprovalOutputModuleRef() as unknown as ModuleRef,
    );

    const gatedInstance = new ApprovedOutputRailTools();
    const gatedTools = gatedProvider.buildTools([gatedInstance], agentContext, 'TestAgent');
    const fetchTool = gatedTools.find((t) => t.name === 'fetchCredentials');

    const gateResult = (await fetchTool?.execute({
      args: { service: 'billing-api' },
    })) as ToolExecutionResult;

    assert(
      !gateResult.success && gateResult.status === 'pending_approval',
      'Test 7a: fetchCredentials suspends with pending_approval',
    );

    if (!gateResult.success && (gateResult as any).approvalId) {
      const pending = await approvalStore.get((gateResult as any).approvalId);
      assert(pending !== undefined, 'Test 7b: Pending approval persisted');

      const resumedResult = (await gatedProvider.invokeApprovedTool(
        [gatedInstance],
        pending!.toolName,
        pending!.args,
        pending!.context,
        pending!.agentName,
      )) as ToolExecutionResult;

      assert(resumedResult?.success === true, 'Test 7c: Approved call executes successfully');
      const resumedData = (resumedResult as any)?.data;
      assert(resumedData?.service === 'billing-api', 'Test 7d: Non-secret field preserved on resume');
      assert(
        resumedData?.apiKey === '[REDACTED_SECRET]',
        'Test 7e: Output Rail sanitizes the approved call result (previously bypassed)',
      );
    }
  } catch (err: any) {
    assert(false, 'Test 7: Output Rails run on approval-resume path', err.message);
  }

  // TEST 8: Module-level default policy chain (#135)
  try {
    const { ExemptFromDefaultPolicies } = await import('../src');

    class DefaultDenyPolicy implements ToolPolicy {
      async evaluate(): Promise<PolicyResult> {
        return { decision: 'deny', reason: 'Blocked by module default policy' };
      }
    }

    @ToolSet({ name: 'default-policy-tools' })
    class DefaultPolicyTools {
      @Tool({ description: 'No explicit @UsePolicies at all' })
      async unguardedAction(@Param('value') value: string) {
        return { value };
      }

      @Tool({ description: 'Exempted from module defaults' })
      @ExemptFromDefaultPolicies()
      async exemptAction(@Param('value') value: string) {
        return { value };
      }
    }

    class DefaultPolicyModuleRef {
      get(token: any): any {
        if (token === DefaultDenyPolicy) return new DefaultDenyPolicy();
        return undefined;
      }
    }

    const defaultPolicyProvider = new LocalToolProvider(
      [new DefaultDenyPolicy()],
      approvalStore,
      discovery,
      new DefaultPolicyModuleRef() as unknown as ModuleRef,
      undefined,
      undefined,
      { defaultModel: {} as any, defaultPolicies: [DefaultDenyPolicy] },
    );

    const defaultPolicyTools = defaultPolicyProvider.buildTools(
      [new DefaultPolicyTools()],
      agentContext,
    );

    const unguardedTool = defaultPolicyTools.find((t) => t.name === 'unguardedAction');
    const unguardedResult = (await unguardedTool?.execute({ args: { value: 'x' } })) as ToolExecutionResult;
    assert(
      !unguardedResult.success && unguardedResult.status === 'denied',
      'Test 8a: a tool with zero explicit @UsePolicies still runs the module default policy chain',
    );

    const exemptTool = defaultPolicyTools.find((t) => t.name === 'exemptAction');
    const exemptResult = (await exemptTool?.execute({ args: { value: 'y' } })) as ToolExecutionResult;
    assert(
      exemptResult.success === true,
      'Test 8b: @ExemptFromDefaultPolicies() opts a tool out of the module default chain',
    );

    // Backward compatibility: no defaultPolicies configured -> no behavior change
    const noDefaultsProvider = new LocalToolProvider(
      [],
      approvalStore,
      discovery,
      new DefaultPolicyModuleRef() as unknown as ModuleRef,
    );
    const noDefaultsTools = noDefaultsProvider.buildTools([new DefaultPolicyTools()], agentContext);
    const noDefaultsResult = (await noDefaultsTools
      .find((t) => t.name === 'unguardedAction')
      ?.execute({ args: { value: 'z' } })) as ToolExecutionResult;
    assert(
      noDefaultsResult.success === true,
      'Test 8c: with no defaultPolicies configured, an unguarded tool behaves exactly as before (backward compatible)',
    );

    // Ordering: default policies run before class/method policies, so an
    // earlier deny short-circuits before a later allow would run.
    class OrderTrackingAllowPolicy implements ToolPolicy {
      static callOrder: string[] = [];
      async evaluate(): Promise<PolicyResult> {
        OrderTrackingAllowPolicy.callOrder.push('method-level');
        return { decision: 'allow' };
      }
    }
    class OrderTrackingDefaultPolicy implements ToolPolicy {
      static callOrder: string[] = [];
      async evaluate(): Promise<PolicyResult> {
        OrderTrackingDefaultPolicy.callOrder.push('default');
        OrderTrackingAllowPolicy.callOrder.push('default');
        return { decision: 'allow' };
      }
    }

    @ToolSet({ name: 'order-tracking-tools' })
    class OrderTrackingTools {
      @Tool({ description: 'Tracks policy evaluation order' })
      @UsePolicies(OrderTrackingAllowPolicy)
      async trackedAction() {
        return { done: true };
      }
    }

    class OrderModuleRef {
      get(token: any): any {
        if (token === OrderTrackingDefaultPolicy) return new OrderTrackingDefaultPolicy();
        if (token === OrderTrackingAllowPolicy) return new OrderTrackingAllowPolicy();
        return undefined;
      }
    }

    const orderProvider = new LocalToolProvider(
      [],
      approvalStore,
      discovery,
      new OrderModuleRef() as unknown as ModuleRef,
      undefined,
      undefined,
      { defaultModel: {} as any, defaultPolicies: [OrderTrackingDefaultPolicy] },
    );

    const orderTools = orderProvider.buildTools([new OrderTrackingTools()], agentContext);
    await orderTools.find((t) => t.name === 'trackedAction')?.execute({ args: {} });
    assert(
      OrderTrackingAllowPolicy.callOrder.join(',') === 'default,method-level',
      'Test 8d: module default policies evaluate before class/method-level @UsePolicies',
    );

    // 8e. An exempt tool with zero policies of its own logs a once-per-tool
    // warning, so running with no policy evaluation at all is visible
    // instead of only discoverable by reading discovery metadata (review feedback).
    @ToolSet({ name: 'silently-unguarded-tools' })
    class SilentlyUnguardedTools {
      @Tool({ description: 'Exempt and has zero policies of its own' })
      @ExemptFromDefaultPolicies()
      async fullyUnguardedAction() {
        return { ran: true };
      }
    }

    const warnSpy: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnSpy.push(msg);
    try {
      const warnProvider = new LocalToolProvider(
        [new DefaultDenyPolicy()],
        approvalStore,
        discovery,
        new DefaultPolicyModuleRef() as unknown as ModuleRef,
        undefined,
        undefined,
        { defaultModel: {} as any, defaultPolicies: [] },
      );
      const warnTools = warnProvider.buildTools([new SilentlyUnguardedTools()], agentContext);
      await warnTools.find((t) => t.name === 'fullyUnguardedAction')?.execute({ args: {} });
      await warnTools.find((t) => t.name === 'fullyUnguardedAction')?.execute({ args: {} });
    } finally {
      console.warn = originalWarn;
    }
    assert(
      warnSpy.some((m) => m.includes('fullyUnguardedAction') && m.includes('zero policy evaluation')),
      'Test 8e: an exempt tool with no @UsePolicies of its own logs a warning that it runs unguarded',
    );
    assert(
      warnSpy.filter((m) => m.includes('fullyUnguardedAction')).length === 1,
      'Test 8e2: the warning is logged once per tool, not once per call',
    );

    // 8f. Two different toolsets exposing a same-named exempt+unguarded tool
    // must each get their own warning — collision-free per-instance/method
    // keying, not keyed by toolName alone (review feedback).
    @ToolSet({ name: 'toolset-a' })
    class ToolsetA {
      @Tool({ name: 'lookup', description: 'Exempt, unguarded, in toolset A' })
      @ExemptFromDefaultPolicies()
      async lookup() {
        return { from: 'A' };
      }
    }
    @ToolSet({ name: 'toolset-b' })
    class ToolsetB {
      @Tool({ name: 'lookup', description: 'Exempt, unguarded, in toolset B' })
      @ExemptFromDefaultPolicies()
      async lookup() {
        return { from: 'B' };
      }
    }

    const collisionWarnSpy: string[] = [];
    const originalWarn2 = console.warn;
    console.warn = (msg: string) => collisionWarnSpy.push(msg);
    try {
      const collisionProvider = new LocalToolProvider(
        [],
        approvalStore,
        discovery,
        new DefaultPolicyModuleRef() as unknown as ModuleRef,
        undefined,
        undefined,
        { defaultModel: {} as any, defaultPolicies: [] },
      );
      const toolsA = collisionProvider.buildTools([new ToolsetA()], agentContext);
      const toolsB = collisionProvider.buildTools([new ToolsetB()], agentContext);
      await toolsA.find((t) => t.name === 'lookup')?.execute({ args: {} });
      await toolsB.find((t) => t.name === 'lookup')?.execute({ args: {} });
    } finally {
      console.warn = originalWarn2;
    }
    assert(
      collisionWarnSpy.filter((m) => m.includes('"lookup"')).length === 2,
      'Test 8f: two distinct toolsets exposing a same-named exempt tool each independently trigger the warning',
    );

    // 8g. options.logger.warn overrides console.warn, matching the codebase's
    // existing override-with-console-fallback logging convention (review feedback)
    const customWarnLog: string[] = [];
    const customLoggerProvider = new LocalToolProvider(
      [],
      approvalStore,
      discovery,
      new DefaultPolicyModuleRef() as unknown as ModuleRef,
      undefined,
      undefined,
      {
        defaultModel: {} as any,
        defaultPolicies: [],
        logger: { warn: (msg: string) => customWarnLog.push(msg) },
      },
    );
    const customLoggerTools = customLoggerProvider.buildTools([new SilentlyUnguardedTools()], agentContext);
    await customLoggerTools.find((t) => t.name === 'fullyUnguardedAction')?.execute({ args: {} });
    assert(
      customWarnLog.some((m) => m.includes('fullyUnguardedAction')),
      'Test 8g: a custom options.logger.warn receives the exemption warning instead of console.warn',
    );
  } catch (err: any) {
    assert(false, 'Test 8: Module-level default policy chain', err.message);
  }

  // TEST 9: Provenance/taint tracking (#137)
  //
  // A successful tool result is stamped with `{ source: 'tool', origin: <toolName> }`,
  // the label survives Output Rail sanitization, and `evaluateOutput` receives it so a
  // policy can make trust-aware decisions. Fully additive — nothing breaks for tools/
  // policies that ignore it.
  try {
    let observedProvenance: unknown;

    class ProvenanceInspectingPolicy implements ToolPolicy {
      async evaluate(): Promise<PolicyResult> {
        return { decision: 'allow' };
      }

      async evaluateOutput(_ctx: AgentContext, _toolName: string, result: any, provenance?: unknown) {
        observedProvenance = provenance;
        // Trust-aware sanitization: only rewrite when the content came from a tool.
        if (result && typeof result === 'object' && result.note) {
          return { decision: 'sanitize' as const, sanitizedResult: { ...result, note: 'clean' } };
        }
        return { decision: 'allow' as const };
      }
    }

    @ToolSet({ name: 'provenance-tools' })
    class ProvenanceTools {
      @Tool({ name: 'readExternal', description: 'Returns some content' })
      @UsePolicies(ProvenanceInspectingPolicy)
      async readExternal() {
        return { note: 'raw' };
      }
    }

    class ProvenanceModuleRef {
      get(token: any): any {
        if (token === ProvenanceInspectingPolicy) return new ProvenanceInspectingPolicy();
        return undefined;
      }
    }

    const provProvider = new LocalToolProvider(
      [new ProvenanceInspectingPolicy()],
      approvalStore,
      discovery,
      new ProvenanceModuleRef() as unknown as ModuleRef,
    );

    const provTools = provProvider.buildTools([new ProvenanceTools()], agentContext, 'TestAgent');
    const readTool = provTools.find((t) => t.name === 'readExternal');
    const provResult = (await readTool?.execute({ args: {} })) as ToolExecutionResult;

    assert(provResult.success === true, 'Test 9a: tool executes successfully');
    assert(
      provResult.success === true && (provResult as any).provenance?.source === 'tool',
      'Test 9b: successful result is stamped with source "tool"',
    );
    assert(
      provResult.success === true && (provResult as any).provenance?.origin === 'readExternal',
      'Test 9c: provenance origin is the tool name',
    );
    assert(
      (observedProvenance as any)?.source === 'tool',
      'Test 9d: evaluateOutput receives the provenance label',
    );
    assert(
      provResult.success === true && (provResult as any).data?.note === 'clean',
      'Test 9e: provenance survives output-rail sanitization (result still sanitized)',
    );

    // Backward compatibility: a policy that ignores the new param still works.
    class LegacyOutputPolicy implements ToolPolicy {
      async evaluate(): Promise<PolicyResult> {
        return { decision: 'allow' };
      }
      async evaluateOutput(_ctx: AgentContext, _toolName: string, result: any) {
        return { decision: 'allow' as const };
      }
    }

    @ToolSet({ name: 'legacy-prov-tools' })
    class LegacyProvTools {
      @Tool({ name: 'legacyRead', description: 'Returns content' })
      @UsePolicies(LegacyOutputPolicy)
      async legacyRead() {
        return { ok: true };
      }
    }

    const legacyProvider = new LocalToolProvider(
      [new LegacyOutputPolicy()],
      approvalStore,
      discovery,
      { get: (t: any) => (t === LegacyOutputPolicy ? new LegacyOutputPolicy() : undefined) } as unknown as ModuleRef,
    );
    const legacyTools = legacyProvider.buildTools([new LegacyProvTools()], agentContext, 'TestAgent');
    const legacyResult = (await legacyTools[0]?.execute({ args: {} })) as ToolExecutionResult;
    assert(
      legacyResult.success === true && (legacyResult as any).provenance?.source === 'tool',
      'Test 9f: a policy that ignores the provenance param is unaffected and provenance is still stamped',
    );
  } catch (err: any) {
    assert(false, 'Test 9: Provenance/taint tracking', err.message);
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
