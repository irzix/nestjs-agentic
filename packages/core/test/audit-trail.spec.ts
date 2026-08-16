import 'reflect-metadata';
import { ModuleRef } from '@nestjs/core';
import {
  Agent,
  AgentExecutor,
  AgentRunner,
  ApprovalService,
  AuditTrail,
  ConsoleAuditSink,
  Context,
  InMemoryAuditSink,
  LocalToolProvider,
  MockModelAdapter,
  Param,
  Tool,
  ToolDiscoveryService,
  ToolSet,
  UsePolicies,
} from '../src';
import type {
  AgentConfig,
  AgentContext,
  AgentProvider,
  AgenticModuleOptions,
  AuditEvent,
  AuditSink,
  PolicyResult,
  ToolPolicy,
} from '../src';
import { InMemoryApprovalStore } from '../src/stores/in-memory-approval.store';
import { InMemorySessionStore } from '../src/stores/in-memory-session.store';

class AmountPolicy implements ToolPolicy {
  async evaluate(
    _ctx: AgentContext,
    _toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    const amount = Number(args.amount);
    if (amount > 5000) return { decision: 'deny', reason: 'Above the hard ceiling.' };
    if (amount > 500) {
      return { decision: 'require_approval', reason: 'Requires manager approval.' };
    }
    return { decision: 'allow' };
  }
}

@ToolSet({ name: 'ledger' })
class LedgerTools {
  readonly transfers: Array<{ amount: number }> = [];
  failNext = false;

  @Tool({ name: 'transferMoney', description: 'Transfer funds' })
  @UsePolicies(AmountPolicy)
  async transferMoney(
    @Param('amount', { type: 'number', required: true }) amount: number,
    @Param('token', { type: 'string' }) _token: string | undefined,
    @Context() _ctx: AgentContext,
  ) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Downstream ledger rejected the transfer.');
    }
    this.transfers.push({ amount });
    return { txId: 'tx_1', amount };
  }
}

@Agent({ name: 'banker', description: 'Handles transfers' })
class BankerAgent implements AgentProvider {
  constructor(private readonly tools: LedgerTools) {}

  define(): AgentConfig {
    return { instructions: 'Move money carefully.', tools: [this.tools] };
  }
}

class MockModuleRef {
  get(): any {
    return undefined;
  }
}

const moduleRef = new MockModuleRef() as unknown as ModuleRef;

/** Builds a wired runner, approval service, and audit sink for one scenario. */
function createHarness(options?: {
  model?: MockModelAdapter;
  moduleOptions?: Partial<AgenticModuleOptions>;
  sinks?: AuditSink[];
}) {
  const sink = new InMemoryAuditSink();
  const sinks = options?.sinks ?? [sink];
  const moduleOptions: AgenticModuleOptions = {
    defaultModel: { provider: 'mock', model: 'deterministic' },
    ...options?.moduleOptions,
  };

  const audit = new AuditTrail(sinks, moduleOptions);
  const approvalStore = new InMemoryApprovalStore();
  const localToolProvider = new LocalToolProvider(
    [new AmountPolicy()],
    approvalStore,
    new ToolDiscoveryService(),
    moduleRef,
    audit,
  );
  const tools = new LedgerTools();
  const runner = new AgentRunner(
    [new BankerAgent(tools)],
    undefined,
    moduleOptions,
    localToolProvider,
    moduleRef,
    new AgentExecutor(options?.model ?? new MockModelAdapter()),
    new InMemorySessionStore(),
    approvalStore,
  );
  const approvals = new ApprovalService(approvalStore, runner, audit);

  return { sink, audit, approvals, runner, tools, approvalStore };
}

function modelRequesting(amount: number, reply: string): MockModelAdapter {
  const model = new MockModelAdapter();
  model
    .whenAsked(`transfer ${amount}`)
    .callTool('transferMoney', { amount, token: 'secret-value' })
    .reply(reply);
  return model;
}

export async function runAuditTrailTests() {
  console.log('📋 Running Step 12: Audit Trail Tests...\n');

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

  // TEST 1: A full approval lifecycle is recorded, including who approved
  try {
    const { sink, approvals, runner, tools } = createHarness({
      model: modelRequesting(2500, 'Transfer complete.'),
    });

    const suspended = await runner.run('banker', {
      sessionId: 'sess_audit_1',
      message: 'transfer 2500',
      context: { tenantId: 'tenant_a', userId: 'agent_caller' },
    });
    const pending = suspended.toolCalls[0]?.result as any;

    const requested = sink.ofType('approval_requested');
    assert(requested.length === 1, 'Test 1a: Requesting approval is recorded');
    assert(
      requested[0]?.approvalId === pending.approvalId,
      'Test 1b: The recorded approvalId matches the one returned to the caller',
    );
    assert(
      requested[0]?.tenantId === 'tenant_a' && requested[0]?.sessionId === 'sess_audit_1',
      'Test 1c: Events carry tenant and session for scoping',
    );
    assert(
      typeof requested[0]?.traceId === 'string' && requested[0].traceId.length > 0,
      'Test 1d: Events carry a traceId for correlation',
      requested[0]?.traceId,
    );

    const boundary = sink.ofType('tool_policy_decision');
    assert(
      boundary.length === 1 && boundary[0]?.decision === 'require_approval',
      'Test 1e: The gating policy decision is recorded',
    );
    assert(
      boundary[0]?.policyName === 'AmountPolicy',
      'Test 1f: The deciding policy is named',
      boundary[0]?.policyName,
    );
    assert(
      boundary[0]?.approvalId === pending.approvalId,
      'Test 1g: The decision links to the approval it created',
    );

    await approvals.approve(pending.approvalId, {
      actor: { userId: 'manager_7', roles: ['approver'], label: 'ops-console' },
    });

    const settled = sink.ofType('approval_settled');
    assert(settled.length === 1, 'Test 1h: Settling the approval is recorded');
    assert(settled[0]?.outcome === 'approved', 'Test 1i: The outcome is recorded');
    assert(
      settled[0]?.actor?.userId === 'manager_7',
      'Test 1j: The approver identity is recorded',
      JSON.stringify(settled[0]?.actor),
    );
    assert(
      settled[0]?.toolName === 'transferMoney' && settled[0]?.agentName === 'banker',
      'Test 1k: The settled event names the tool and agent',
    );
    assert(tools.transfers.length === 1, 'Test 1l: The approved side effect ran once');
  } catch (err: any) {
    assert(false, 'Test 1: Approval lifecycle is audited', err.message);
  }

  // TEST 2: Rejection is recorded with its reason
  try {
    const { sink, approvals, runner, tools } = createHarness({
      model: modelRequesting(2500, 'Not approved.'),
    });

    const suspended = await runner.run('banker', {
      sessionId: 'sess_audit_2',
      message: 'transfer 2500',
    });
    const pending = suspended.toolCalls[0]?.result as any;

    await approvals.reject(pending.approvalId, {
      reason: 'Vendor not verified.',
      actor: { userId: 'manager_9' },
    });

    const settled = sink.ofType('approval_settled');
    assert(settled[0]?.outcome === 'rejected', 'Test 2a: A rejection is recorded as rejected');
    assert(
      settled[0]?.reason === 'Vendor not verified.',
      'Test 2b: The rejection reason is recorded',
      settled[0]?.reason,
    );
    assert(
      settled[0]?.actor?.userId === 'manager_9',
      'Test 2c: The rejecting actor is recorded',
    );
    assert(tools.transfers.length === 0, 'Test 2d: The rejected side effect never ran');
  } catch (err: any) {
    assert(false, 'Test 2: Rejection is audited', err.message);
  }

  // TEST 3: A denied call is recorded without creating an approval
  try {
    const { sink, runner, tools } = createHarness({
      model: modelRequesting(9000, 'Cannot do that.'),
    });

    await runner.run('banker', { sessionId: 'sess_audit_3', message: 'transfer 9000' });

    const boundary = sink.ofType('tool_policy_decision');
    assert(
      boundary.length === 1 && boundary[0]?.decision === 'deny',
      'Test 3a: A denied tool call is recorded',
    );
    assert(
      boundary[0]?.reason === 'Above the hard ceiling.',
      'Test 3b: The denial reason is recorded',
    );
    assert(
      sink.ofType('approval_requested').length === 0,
      'Test 3c: A denial creates no approval event',
    );
    assert(tools.transfers.length === 0, 'Test 3d: The denied side effect never ran');
  } catch (err: any) {
    assert(false, 'Test 3: Denial is audited', err.message);
  }

  // TEST 4: allow decisions are filtered by default, and opt-in when requested
  try {
    const quiet = createHarness({ model: modelRequesting(100, 'Sent.') });
    await quiet.runner.run('banker', { sessionId: 'sess_audit_4a', message: 'transfer 100' });

    assert(
      quiet.sink.ofType('tool_policy_decision').length === 0,
      'Test 4a: allow decisions are not recorded by default',
      String(quiet.sink.all().length),
    );
    assert(quiet.tools.transfers.length === 1, 'Test 4b: The allowed call still executed');

    const verbose = createHarness({
      model: modelRequesting(100, 'Sent.'),
      moduleOptions: { audit: { includeAllowDecisions: true } },
    });
    await verbose.runner.run('banker', { sessionId: 'sess_audit_4b', message: 'transfer 100' });

    const allowed = verbose.sink.ofType('tool_policy_decision');
    assert(
      allowed.length === 1 && allowed[0]?.decision === 'allow',
      'Test 4c: includeAllowDecisions records allow decisions',
    );
  } catch (err: any) {
    assert(false, 'Test 4: allow decision filtering', err.message);
  }

  // TEST 5: Arguments are withheld by default and redacted when included
  try {
    const withheld = createHarness({ model: modelRequesting(2500, 'ok') });
    await withheld.runner.run('banker', { sessionId: 'sess_audit_5a', message: 'transfer 2500' });

    const withheldEvent = withheld.sink.ofType('approval_requested')[0] as any;
    assert(
      withheldEvent?.args === undefined,
      'Test 5a: Arguments are not recorded by default',
      JSON.stringify(withheldEvent?.args),
    );

    const included = createHarness({
      model: modelRequesting(2500, 'ok'),
      moduleOptions: { audit: { includeArgs: true, sensitiveFields: ['token'] } },
    });
    await included.runner.run('banker', { sessionId: 'sess_audit_5b', message: 'transfer 2500' });

    const includedEvent = included.sink.ofType('approval_requested')[0];
    assert(
      includedEvent?.args?.amount === 2500,
      'Test 5b: includeArgs records non-sensitive arguments',
      JSON.stringify(includedEvent?.args),
    );
    assert(
      includedEvent?.args?.token === '***REDACTED***',
      'Test 5c: Sensitive argument fields are masked',
      JSON.stringify(includedEvent?.args),
    );
  } catch (err: any) {
    assert(false, 'Test 5: Argument redaction', err.message);
  }

  // TEST 6: A late decision records the expiry rather than the settlement
  try {
    const { sink, approvals, approvalStore, runner, tools } = createHarness({
      model: modelRequesting(2500, 'ok'),
      moduleOptions: { approvalTtlSeconds: 3600 },
    });

    const suspended = await runner.run('banker', {
      sessionId: 'sess_audit_6',
      message: 'transfer 2500',
    });
    const pending = suspended.toolCalls[0]?.result as any;

    const stored = await approvalStore.get(pending.approvalId);
    await approvalStore.save({ ...stored!, expiresAt: new Date(Date.now() - 1000) });

    try {
      await approvals.approve(pending.approvalId, { actor: { userId: 'late_manager' } });
    } catch {
      // Expected: the approval expired.
    }

    const expired = sink.ofType('approval_expired');
    assert(expired.length === 1, 'Test 6a: A refused late decision is recorded');
    assert(
      expired[0]?.actor?.userId === 'late_manager',
      'Test 6b: The actor who attempted the late decision is recorded',
    );
    assert(
      sink.ofType('approval_settled').length === 0,
      'Test 6c: An expired approval records no settlement',
    );
    assert(tools.transfers.length === 0, 'Test 6d: The expired side effect never ran');
  } catch (err: any) {
    assert(false, 'Test 6: Expiry is audited', err.message);
  }

  // TEST 7: A tool failing after the claim is recorded as a failed settlement
  try {
    const { sink, approvals, runner, tools } = createHarness({
      model: modelRequesting(2500, 'ok'),
      moduleOptions: { toolErrorHandling: 'throw' },
    });

    const suspended = await runner.run('banker', {
      sessionId: 'sess_audit_7',
      message: 'transfer 2500',
    });
    const pending = suspended.toolCalls[0]?.result as any;

    tools.failNext = true;

    let threw = false;
    try {
      await approvals.approve(pending.approvalId, { actor: { userId: 'manager_3' } });
    } catch {
      threw = true;
    }

    const failures = sink.ofType('approval_settlement_failed');
    assert(threw, 'Test 7a: The failure still surfaces to the caller');
    assert(failures.length === 1, 'Test 7b: A settlement that fails after the claim is recorded');
    assert(
      Boolean(failures[0]?.error?.includes('Downstream ledger')),
      'Test 7c: The failure reason is recorded',
      failures[0]?.error,
    );
    assert(
      failures[0]?.outcome === 'approved' && failures[0]?.actor?.userId === 'manager_3',
      'Test 7d: The attempted outcome and actor are recorded',
    );
    assert(
      sink.ofType('approval_settled').length === 0,
      'Test 7e: A failed settlement is not also recorded as settled',
    );
  } catch (err: any) {
    assert(false, 'Test 7: Failed settlement is audited', err.message);
  }

  // TEST 8: A failing sink never breaks the governed operation
  try {
    const exploding: AuditSink = {
      record() {
        throw new Error('audit backend unreachable');
      },
    };
    const working = new InMemoryAuditSink();

    const { approvals, runner, tools } = createHarness({
      model: modelRequesting(2500, 'Transfer complete.'),
      sinks: [exploding, working],
    });

    const suspended = await runner.run('banker', {
      sessionId: 'sess_audit_8',
      message: 'transfer 2500',
    });
    const pending = suspended.toolCalls[0]?.result as any;
    const resumed = (await approvals.approve(pending.approvalId)) as any;

    assert(
      resumed.output === 'Transfer complete.',
      'Test 8a: A failing sink does not fail the approval',
    );
    assert(tools.transfers.length === 1, 'Test 8b: The side effect still ran exactly once');
    assert(
      working.ofType('approval_settled').length === 1,
      'Test 8c: A healthy sink still receives the event',
    );
  } catch (err: any) {
    assert(false, 'Test 8: Sink failure isolation', err.message);
  }

  // TEST 9: With no sink registered, nothing is recorded and nothing breaks
  try {
    const audit = new AuditTrail(undefined, {
      defaultModel: { provider: 'mock', model: 'deterministic' },
    });

    assert(!audit.isEnabled(), 'Test 9a: Auditing is disabled without a sink');

    let threw = false;
    try {
      await audit.record({
        at: new Date(),
        sessionId: 's',
        traceId: 't',
        type: 'approval_requested',
        approvalId: 'a',
        agentName: 'banker',
        toolName: 'transferMoney',
        reason: 'r',
      });
    } catch {
      threw = true;
    }
    assert(!threw, 'Test 9b: Recording without a sink is a no-op rather than an error');

    const { runner, tools } = createHarness({
      model: modelRequesting(100, 'Sent.'),
      sinks: [],
    });
    await runner.run('banker', { sessionId: 'sess_audit_9', message: 'transfer 100' });
    assert(tools.transfers.length === 1, 'Test 9c: Execution is unaffected without auditing');
  } catch (err: any) {
    assert(false, 'Test 9: Auditing is opt-in', err.message);
  }

  // TEST 10: ConsoleAuditSink formats a greppable line per event
  try {
    const lines: string[] = [];
    const sink = new ConsoleAuditSink({ logger: (message) => lines.push(message) });

    const events: AuditEvent[] = [
      {
        at: new Date(),
        sessionId: 's',
        traceId: 't',
        type: 'approval_settled',
        approvalId: 'apr_1',
        agentName: 'banker',
        toolName: 'transferMoney',
        outcome: 'approved',
        actor: { userId: 'manager_7' },
      },
      {
        at: new Date(),
        sessionId: 's',
        traceId: 't',
        type: 'tool_policy_decision',
        agentName: 'banker',
        toolName: 'transferMoney',
        policyName: 'AmountPolicy',
        decision: 'deny',
        reason: 'too big',
      },
    ];

    for (const event of events) sink.record(event);

    assert(
      Boolean(lines[0]?.includes('approval_settled') && lines[0]?.includes('manager_7')),
      'Test 10a: A settled line names the outcome and actor',
      lines[0],
    );
    assert(
      Boolean(lines[1]?.includes('deny') && lines[1]?.includes('AmountPolicy')),
      'Test 10b: A policy line names the decision and policy',
      lines[1],
    );
  } catch (err: any) {
    assert(false, 'Test 10: Console sink formatting', err.message);
  }

  // TEST 11: OpenTelemetry GenAI Semantic Conventions Mapping
  try {
    const { toOpenTelemetryGenAiAttributes, OpenTelemetryGenAiSink, OpenTelemetryGenAiConventions } =
      await import('../src/audit');

    const sampleEvent: AuditEvent = {
      at: new Date(),
      sessionId: 'sess_otel_123',
      traceId: 'trc_otel_456',
      tenantId: 'tenant_acme',
      type: 'tool_policy_decision',
      agentName: 'SecurityReviewer',
      toolName: 'executeSandboxCode',
      policyName: 'SecretRedactionPolicy',
      decision: 'allow',
    };

    const attrs = toOpenTelemetryGenAiAttributes(sampleEvent);

    assert(attrs[OpenTelemetryGenAiConventions.SYSTEM] === 'nestjs-agentic', 'Test 11a: gen_ai.system matches framework name');
    assert(attrs[OpenTelemetryGenAiConventions.SESSION_ID] === 'sess_otel_123', 'Test 11b: gen_ai.session.id matches session');
    assert(attrs[OpenTelemetryGenAiConventions.TRACE_ID] === 'trc_otel_456', 'Test 11c: gen_ai.trace.id matches trace');
    assert(attrs[OpenTelemetryGenAiConventions.TENANT_ID] === 'tenant_acme', 'Test 11d: gen_ai.tenant.id matches tenant');
    assert(attrs[OpenTelemetryGenAiConventions.AGENT_NAME] === 'SecurityReviewer', 'Test 11e: gen_ai.agent.name matches agent');
    assert(attrs[OpenTelemetryGenAiConventions.TOOL_NAME] === 'executeSandboxCode', 'Test 11f: gen_ai.tool.name matches tool');
    assert(attrs[OpenTelemetryGenAiConventions.POLICY_NAME] === 'SecretRedactionPolicy', 'Test 11g: gen_ai.policy.name matches policy');
    assert(attrs[OpenTelemetryGenAiConventions.POLICY_DECISION] === 'allow', 'Test 11h: gen_ai.policy.decision matches decision');

    // Test OpenTelemetryGenAiSink with custom exporter callback
    let recordedAttrs: Record<string, unknown> | null = null;
    const otelSink = new OpenTelemetryGenAiSink({
      exporter: (attributes) => {
        recordedAttrs = attributes;
      },
    });

    await otelSink.record(sampleEvent);
    assert(recordedAttrs !== null, 'Test 11i: OpenTelemetryGenAiSink dispatches attributes to exporter');
    assert(recordedAttrs?.[OpenTelemetryGenAiConventions.AGENT_NAME] === 'SecurityReviewer', 'Test 11j: Exporter receives valid OTel attributes');
  } catch (err: any) {
    assert(false, 'Test 11: OpenTelemetry GenAI Semantic Conventions', err.message);
  }

  console.log(`\n  📊 Step 12 Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Step 12 Unit Tests Failed');
  }
}

if (require.main === module) {
  runAuditTrailTests().catch(() => process.exit(1));
}
