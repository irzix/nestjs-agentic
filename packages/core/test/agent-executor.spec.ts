import 'reflect-metadata';
import { ModuleRef } from '@nestjs/core';
import {
  Agent,
  AgentExecutor,
  AgentRunner,
  Context,
  ExecutionCancelledError,
  ExecutionLimitExceededError,
  InMemoryApprovalStore,
  LocalToolProvider,
  MockModelAdapter,
  Param,
  PolicyNotRegisteredError,
  SecretRedactionPolicy,
  Tool,
  ToolDiscoveryService,
  ToolSet,
  UsePolicies,
  validateToolArgs,
} from '../src';
import type {
  AgentConfig,
  AgentContext,
  AgentProvider,
  AgentStreamEvent,
  PolicyResult,
  ToolPolicy,
} from '../src';

class RefundLimitPolicy implements ToolPolicy {
  async evaluate(
    _ctx: AgentContext,
    _toolName: string,
    args: Record<string, unknown>,
  ): Promise<PolicyResult> {
    return Number(args.amount) > 500
      ? { decision: 'require_approval', reason: 'Refund exceeds $500.' }
      : { decision: 'allow' };
  }
}

class BlockExportPolicy implements ToolPolicy {
  async evaluate(): Promise<PolicyResult> {
    return { decision: 'deny', reason: 'Exports are disabled.' };
  }
}

class UnregisteredPolicy implements ToolPolicy {
  async evaluate(): Promise<PolicyResult> {
    return { decision: 'allow' };
  }
}

/**
 * Zero-arg wrapper so `SecretRedactionPolicy` (whose constructor takes an
 * optional typed options object) can be referenced as a bare class in
 * `@UsePolicies`. `PolicyInput`'s `new (...args: unknown[]) => ToolPolicy`
 * signature isn't assignable from a constructor with an options-typed
 * parameter, since `unknown` isn't assignable to that options type — a
 * pre-existing type-strictness gap in every built-in policy with
 * constructor options, unrelated to this test.
 */
class DefaultSecretRedactionPolicy extends SecretRedactionPolicy {
  constructor() {
    super();
  }
}

@ToolSet({ name: 'orders' })
class OrderTools {
  readonly refunded: Array<{ orderId: string; amount: number; userId?: string }> = [];
  lookupCalls = 0;
  exportCalls = 0;
  flakyCalls = 0;

  @Tool({ name: 'lookupOrder', description: 'Look up an order' })
  async lookupOrder(@Param('orderId') orderId: string) {
    this.lookupCalls++;
    return { orderId, status: 'shipped' };
  }

  @Tool({ name: 'refundOrder', description: 'Refund an order' })
  @UsePolicies(RefundLimitPolicy)
  async refundOrder(
    @Param('orderId') orderId: string,
    @Param('amount', { type: 'number', required: true }) amount: number,
    @Context() ctx: AgentContext,
  ) {
    this.refunded.push({ orderId, amount, userId: ctx.security.userId });
    return { refunded: true, orderId, amount };
  }

  @Tool({ name: 'exportOrders', description: 'Export all orders' })
  @UsePolicies(BlockExportPolicy)
  async exportOrders() {
    this.exportCalls++;
    return { exported: true };
  }

  @Tool({ name: 'flakyLookup', description: 'Look up an order in a flaky system' })
  async flakyLookup(@Param('orderId') orderId: string) {
    this.flakyCalls++;
    const error = new Error(`Order ${orderId} not found in ledger`);
    error.stack = 'Error: secret internal stack trace\n    at Ledger.query';
    throw error;
  }

  @Tool({ name: 'leakySecretLookup', description: 'A tool whose failure message contains a secret' })
  @UsePolicies(DefaultSecretRedactionPolicy)
  async leakySecretLookup() {
    throw new Error(
      'Connection failed: postgres://admin:sup3rSecretPW@db.internal:5432/orders',
    );
  }

  @Tool({ name: 'misconfigured', description: 'Tool with an unregistered policy' })
  @UsePolicies(UnregisteredPolicy)
  async misconfigured() {
    return { ok: true };
  }
}

@Agent({ name: 'support', description: 'Support agent' })
class SupportAgent implements AgentProvider {
  constructor(private readonly tools: OrderTools) {}

  define(): AgentConfig {
    return { instructions: 'Help the customer.', tools: [this.tools] };
  }
}

class MockModuleRef {
  get(): any {
    return undefined;
  }
}

export async function runAgentExecutorTests() {
  console.log('⚙️  Running Step 7: AgentExecutor Runtime Loop Tests...\n');

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

  const moduleRef = new MockModuleRef() as unknown as ModuleRef;

  function createHarness(model: MockModelAdapter) {
    const tools = new OrderTools();
    const approvalStore = new InMemoryApprovalStore();
    const localToolProvider = new LocalToolProvider(
      [new RefundLimitPolicy(), new BlockExportPolicy(), new DefaultSecretRedactionPolicy()],
      approvalStore,
      new ToolDiscoveryService(),
      moduleRef,
    );

    const runner = new AgentRunner(
      [new SupportAgent(tools)],
      undefined,
      { defaultModel: { provider: 'mock', model: 'deterministic' } },
      localToolProvider,
      moduleRef,
      new AgentExecutor(model),
    );

    return { runner, tools, approvalStore };
  }

  // TEST 1: Multi-round tool loop feeds results back to the model
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Where is order 42 and refund $100')
      .callTool('lookupOrder', { orderId: '42' })
      .callTool('refundOrder', { orderId: '42', amount: 100 })
      .reply('Order 42 shipped and $100 was refunded.');

    const { runner, tools } = createHarness(model);
    const result = await runner.run('support', {
      sessionId: 'sess_1',
      message: 'Where is order 42 and refund $100',
      context: { userId: 'usr_1' },
    });

    assert(tools.lookupCalls === 1, 'Test 1a: First tool executed once');
    assert(tools.refunded.length === 1, 'Test 1b: Second tool executed after feedback');
    assert(
      tools.refunded[0]?.userId === 'usr_1',
      'Test 1c: AgentContext stays bound through the loop',
    );
    assert(result.toolCalls.length === 2, 'Test 1d: Both tool calls recorded in result');
    assert(
      result.output === 'Order 42 shipped and $100 was refunded.',
      'Test 1e: Final model answer returned as output',
    );
  } catch (err: any) {
    assert(false, 'Test 1: Multi-round tool loop', err.message);
  }

  // TEST 2: Invalid arguments never reach the application method
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Refund without amount')
      .callTool('refundOrder', { orderId: '42' })
      .reply('I could not complete the refund.');

    const { runner, tools } = createHarness(model);
    const result = await runner.run('support', {
      sessionId: 'sess_2',
      message: 'Refund without amount',
    });

    assert(tools.refunded.length === 0, 'Test 2a: Tool method not invoked with missing argument');
    assert(result.toolCalls.length === 0, 'Test 2b: Rejected call not recorded as executed');
    assert(
      result.output === 'I could not complete the refund.',
      'Test 2c: Validation error handed back to the model',
    );
  } catch (err: any) {
    assert(false, 'Test 2: Argument validation', err.message);
  }

  // TEST 3: Policy denial is reported without executing the method
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Export everything')
      .callTool('exportOrders', {})
      .reply('Export is not permitted.');

    const { runner, tools } = createHarness(model);
    const result = await runner.run('support', {
      sessionId: 'sess_3',
      message: 'Export everything',
    });

    assert(tools.exportCalls === 0, 'Test 3a: Denied tool method never runs');
    const denied = result.toolCalls[0]?.result as any;
    assert(denied?.status === 'denied', 'Test 3b: Denial recorded in tool call result');
    assert(result.output === 'Export is not permitted.', 'Test 3c: Loop continues after denial');
  } catch (err: any) {
    assert(false, 'Test 3: Policy denial handling', err.message);
  }

  // TEST 4: Approval suspends the turn instead of continuing
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Refund $900 for order 7')
      .callTool('refundOrder', { orderId: '7', amount: 900 })
      .reply('This line must not be reached.');

    const { runner, tools, approvalStore } = createHarness(model);
    const result = await runner.run('support', {
      sessionId: 'sess_4',
      message: 'Refund $900 for order 7',
    });

    const pending = result.toolCalls[0]?.result as any;
    assert(pending?.status === 'pending_approval', 'Test 4a: Approval required result returned');
    assert(tools.refunded.length === 0, 'Test 4b: Side effect deferred until approval');
    assert(
      result.output !== 'This line must not be reached.',
      'Test 4c: Loop suspends rather than continuing',
    );
    assert(
      Boolean(await approvalStore.get(pending.approvalId)),
      'Test 4d: Pending approval persisted for later resolution',
    );
  } catch (err: any) {
    assert(false, 'Test 4: Approval suspension', err.message);
  }

  // TEST 5: Iteration budget stops runaway loops
  try {
    const model = new MockModelAdapter();
    const script = model.whenAsked('Loop forever');
    for (let i = 0; i < 10; i++) {
      script.callTool('lookupOrder', { orderId: String(i) });
    }
    script.reply('done');

    const { runner } = createHarness(model);
    let caught: unknown;
    try {
      await runner.run('support', {
        sessionId: 'sess_5',
        message: 'Loop forever',
        limits: { maxIterations: 3 },
      });
    } catch (err) {
      caught = err;
    }

    assert(
      caught instanceof ExecutionLimitExceededError,
      'Test 5a: Iteration budget raises ExecutionLimitExceededError',
    );
    assert(
      (caught as ExecutionLimitExceededError)?.kind === 'max_iterations',
      'Test 5b: Limit kind identifies the exhausted budget',
    );
  } catch (err: any) {
    assert(false, 'Test 5: Iteration budget', err.message);
  }

  // TEST 6: Tool-call budget is enforced independently
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Check two orders')
      .callTools([
        { name: 'lookupOrder', args: { orderId: '1' } },
        { name: 'lookupOrder', args: { orderId: '2' } },
      ])
      .reply('done');

    const { runner, tools } = createHarness(model);
    let caught: unknown;
    try {
      await runner.run('support', {
        sessionId: 'sess_6',
        message: 'Check two orders',
        limits: { maxToolCalls: 1 },
      });
    } catch (err) {
      caught = err;
    }

    assert(
      (caught as ExecutionLimitExceededError)?.kind === 'max_tool_calls',
      'Test 6a: Tool-call budget enforced across parallel calls',
    );
    assert(tools.lookupCalls === 1, 'Test 6b: Execution stops at the configured budget');
  } catch (err: any) {
    assert(false, 'Test 6: Tool-call budget', err.message);
  }

  // TEST 7: Cancellation propagates through the loop
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Start work')
      .callTool('lookupOrder', { orderId: '9' })
      .reply('done');

    const { runner } = createHarness(model);
    const controller = new AbortController();
    controller.abort();

    let caught: unknown;
    try {
      await runner.run('support', {
        sessionId: 'sess_7',
        message: 'Start work',
        signal: controller.signal,
      });
    } catch (err) {
      caught = err;
    }

    assert(
      caught instanceof ExecutionCancelledError,
      'Test 7a: Aborted signal raises ExecutionCancelledError',
    );
  } catch (err: any) {
    assert(false, 'Test 7: Cancellation', err.message);
  }

  // TEST 8: Streaming emits tokens plus governed tool lifecycle events
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Refund $100 for order 3')
      .callTool('refundOrder', { orderId: '3', amount: 100 })
      .reply('Refund complete.');

    const { runner } = createHarness(model);
    const events: AgentStreamEvent[] = [];
    for await (const event of runner.runStream('support', {
      sessionId: 'sess_8',
      message: 'Refund $100 for order 3',
    })) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    assert(types.includes('token'), 'Test 8a: Model tokens streamed');
    assert(
      types.indexOf('tool_start') < types.indexOf('tool_result'),
      'Test 8b: Tool lifecycle events ordered',
    );
    const complete = events[events.length - 1];
    assert(
      complete.type === 'complete' && complete.output === 'Refund complete.',
      'Test 8c: Stream ends with the final answer',
    );
  } catch (err: any) {
    assert(false, 'Test 8: Streaming loop', err.message);
  }

  // TEST 9: RuntimeAdapter path stays available for existing applications
  try {
    const { MockRuntimeAdapter } = await import('../src');
    const legacy = new MockRuntimeAdapter();
    legacy.whenAsked('legacy path').thenCallTool('lookupOrder', { orderId: '5' });

    const tools = new OrderTools();
    const localToolProvider = new LocalToolProvider(
      [],
      new InMemoryApprovalStore(),
      new ToolDiscoveryService(),
      moduleRef,
    );
    const runner = new AgentRunner(
      [new SupportAgent(tools)],
      legacy,
      { defaultModel: { provider: 'mock', model: 'deterministic' } },
      localToolProvider,
      moduleRef,
      new AgentExecutor(),
    );

    const result = await runner.run('support', {
      sessionId: 'sess_9',
      message: 'legacy path',
    });

    assert(tools.lookupCalls === 1, 'Test 9a: RuntimeAdapter still drives execution');
    assert(
      result.output.includes('lookupOrder'),
      'Test 9b: RuntimeAdapter output returned unchanged',
    );
  } catch (err: any) {
    assert(false, 'Test 9: Backward compatible runtime path', err.message);
  }

  // TEST 10: Argument validator drops undeclared keys and coerces types
  try {
    const validation = validateToolArgs(
      [
        { name: 'orderId', type: 'string', required: true },
        { name: 'amount', type: 'number', required: true },
      ],
      { orderId: 42, amount: '150', injected: 'ignore-me' },
    );

    assert(validation.valid, 'Test 10a: Coercible arguments accepted');
    assert(validation.args.orderId === '42', 'Test 10b: Number coerced to declared string');
    assert(validation.args.amount === 150, 'Test 10c: Numeric string coerced to number');
    assert(
      !Object.prototype.hasOwnProperty.call(validation.args, 'injected'),
      'Test 10d: Undeclared arguments dropped before execution',
    );
  } catch (err: any) {
    assert(false, 'Test 10: Argument validator', err.message);
  }

  // TEST 11: A throwing tool is reported to the model instead of ending the turn
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Look up order 99')
      .callTool('flakyLookup', { orderId: '99' })
      .reply('That order is not in the ledger.');

    const { runner, tools } = createHarness(model);
    const result = await runner.run('support', {
      sessionId: 'sess_11',
      message: 'Look up order 99',
    });

    assert(tools.flakyCalls === 1, 'Test 11a: Tool was invoked');
    assert(
      result.output === 'That order is not in the ledger.',
      'Test 11b: Turn continues after a tool throws',
    );

    const failure = result.toolCalls[0]?.result as any;
    assert(failure?.status === 'error', 'Test 11c: Failure recorded on the tool call');
    assert(
      String(failure?.error).includes('not found in ledger'),
      'Test 11d: Error message preserved for the model',
    );
    assert(
      !String(failure?.error).includes('secret internal stack trace'),
      'Test 11e: Stack trace never forwarded',
    );
  } catch (err: any) {
    assert(false, 'Test 11: Tool error reported', err.message);
  }

  // TEST 12: Tool errors can be made fatal
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Look up order 99')
      .callTool('flakyLookup', { orderId: '99' })
      .reply('unreachable');

    const { runner } = createHarness(model);
    let caught: any;
    try {
      await runner.run('support', {
        sessionId: 'sess_12',
        message: 'Look up order 99',
        toolErrorHandling: 'throw',
      });
    } catch (err) {
      caught = err;
    }

    assert(
      caught instanceof Error && String(caught.message).includes('not found in ledger'),
      'Test 12a: throw mode propagates the original tool error',
    );
  } catch (err: any) {
    assert(false, 'Test 12: Fatal tool errors', err.message);
  }

  // TEST 13: Framework configuration errors are never reported to the model
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Run misconfigured tool')
      .callTool('misconfigured', {})
      .reply('unreachable');

    const { runner } = createHarness(model);
    let caught: any;
    try {
      await runner.run('support', {
        sessionId: 'sess_13',
        message: 'Run misconfigured tool',
      });
    } catch (err) {
      caught = err;
    }

    assert(
      caught instanceof PolicyNotRegisteredError,
      'Test 13a: Missing policy registration surfaces to the caller',
    );
    assert(
      String(caught?.message).includes('UnregisteredPolicy'),
      'Test 13b: Error names the unregistered policy',
    );
  } catch (err: any) {
    assert(false, 'Test 13: Framework errors stay fatal', err.message);
  }

  // TEST 14: Streaming emits a terminal event for a failed tool
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Look up order 99')
      .callTool('flakyLookup', { orderId: '99' })
      .reply('That order is not in the ledger.');

    const { runner } = createHarness(model);
    const events: AgentStreamEvent[] = [];
    for await (const event of runner.runStream('support', {
      sessionId: 'sess_14',
      message: 'Look up order 99',
    })) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    assert(types.includes('tool_error'), 'Test 14a: tool_error event emitted');
    assert(
      types.indexOf('tool_start') < types.indexOf('tool_error'),
      'Test 14b: Failure follows the tool start event',
    );
    assert(!types.includes('tool_result'), 'Test 14c: No success event for a failed tool');
    assert(
      events[events.length - 1].type === 'complete',
      'Test 14d: Stream still completes normally',
    );
  } catch (err: any) {
    assert(false, 'Test 14: Streaming tool errors', err.message);
  }

  // TEST 15: In-Flight Checkpointing Captures Intermediate Tool Rounds
  let capturedCheckpoint: any;
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Process multi-step order')
      .callTool('lookupOrder', { orderId: '42' })
      .callTool('lookupOrder', { orderId: '43' })
      .reply('All orders looked up successfully.');

    const { runner } = createHarness(model);
    const checkpoints: any[] = [];

    const executor = new AgentExecutor(model);
    const prepared = await runner.prepare('support', {
      sessionId: 'sess_15_executor',
      message: 'Process multi-step order',
    });

    await executor.execute({
      sessionId: 'sess_15_executor',
      message: 'Process multi-step order',
      model: prepared.model,
      tools: prepared.tools,
      instructions: prepared.config.instructions,
      onCheckpoint: (cp) => {
        checkpoints.push(cp);
      },
    });

    assert(checkpoints.length >= 1, 'Test 15a: In-flight checkpoint emitted after intermediate round');
    capturedCheckpoint = checkpoints[0];
    assert(capturedCheckpoint.version === 1, 'Test 15b: Checkpoint carries version 1');
    assert(capturedCheckpoint.iteration >= 1, 'Test 15c: Iteration index recorded');
    assert(Array.isArray(capturedCheckpoint.messages), 'Test 15d: Accumulated messages captured');
    assert(
      capturedCheckpoint.messages.some((m: any) => m.role === 'tool'),
      'Test 15e: Tool results preserved in checkpoint',
    );
  } catch (err: any) {
    assert(false, 'Test 15: In-Flight Checkpoint Capture', err.message);
  }

  // TEST 16: Resume Directly from In-Flight Checkpoint Without Re-executing Previous Tools
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Process multi-step order')
      .callTool('lookupOrder', { orderId: '42' })
      .reply('All orders processed after resume.');

    const { runner, tools } = createHarness(model);

    // Initial tool call count is 0 on fresh runner
    assert(tools.lookupCalls === 0, 'Test 16a: No tools executed yet on fresh runner');

    // Resume from capturedCheckpoint which already ran lookupOrder('42') and lookupOrder('43')
    const resumedResult = await runner.resumeCheckpoint('support', capturedCheckpoint);
    assert(
      tools.lookupCalls === 0,
      'Test 16b: Previous tools were not re-executed upon resuming from checkpoint',
    );
    assert(
      resumedResult.output === 'All orders processed after resume.',
      'Test 16c: Final model answer returned from resumed turn',
    );
    assert(
      resumedResult.toolCalls.length === 0,
      'Test 16d: Resumed turn only recorded newly executed tool calls',
    );
  } catch (err: any) {
    assert(false, 'Test 16: Checkpoint Resumption', err.message);
  }

  // TEST 17: InFlightCheckpointVersionError On Unsupported Schema Version
  try {
    const { InFlightCheckpointVersionError } = await import('../src');
    const model = new MockModelAdapter();
    const { runner } = createHarness(model);

    const badCheckpoint = {
      ...capturedCheckpoint,
      version: 999,
    };

    let caughtErr: unknown;
    try {
      await runner.resumeCheckpoint('support', badCheckpoint);
    } catch (err) {
      caughtErr = err;
    }

    assert(
      caughtErr instanceof InFlightCheckpointVersionError,
      'Test 17a: Throws InFlightCheckpointVersionError for unsupported version',
    );
    assert(
      (caughtErr as any)?.found === 999,
      'Test 17b: Error carries found version',
    );
  } catch (err: any) {
    assert(false, 'Test 17: Checkpoint Version Validation', err.message);
  }

  // TEST 18: Durable Recovery from StateStore (recoverLatestCheckpoint)
  try {
    const { InMemoryStateStore } = await import('../src');
    const stateStore = new InMemoryStateStore();
    const model = new MockModelAdapter();
    model
      .whenAsked('Multi-step with state store')
      .callTool('lookupOrder', { orderId: '100' })
      .reply('Finished.');

    const tools = new OrderTools();
    const approvalStore = new InMemoryApprovalStore();
    const localToolProvider = new LocalToolProvider(
      [],
      approvalStore,
      new ToolDiscoveryService(),
      moduleRef,
    );

    const runner = new AgentRunner(
      [new SupportAgent(tools)],
      undefined,
      {
        defaultModel: { provider: 'mock', model: 'deterministic' },
        stateStore,
      },
      localToolProvider,
      moduleRef,
      new AgentExecutor(model),
      undefined,
      undefined,
      stateStore,
    );

    await runner.run('support', {
      sessionId: 'sess_18_recovery',
      message: 'Multi-step with state store',
    });

    const latest = await stateStore.get<any>('checkpoint:latest:sess_18_recovery');
    assert(latest !== null && latest !== undefined, 'Test 18a: Latest checkpoint saved to StateStore');
    assert(latest.version === 1, 'Test 18b: StateStore checkpoint has version 1');

    const recovered = await runner.recoverLatestCheckpoint('support', 'sess_18_recovery');
    assert(recovered.output === 'Finished.', 'Test 18c: recoverLatestCheckpoint succeeded');
  } catch (err: any) {
    assert(false, 'Test 18: StateStore Checkpoint Recovery', err.message);
  }

  // TEST 19: A thrown error containing a secret is sanitized by Output Rails (#127)
  try {
    const model = new MockModelAdapter();
    model
      .whenAsked('Connect to the ledger database')
      .callTool('leakySecretLookup', {})
      .reply('Could not reach the database.');

    const { runner } = createHarness(model);
    const result = await runner.run('support', {
      sessionId: 'sess_19_secret',
      message: 'Connect to the ledger database',
    });

    const failure = result.toolCalls[0]?.result as any;
    assert(failure?.status === 'error', 'Test 19a: Failure recorded on the tool call');
    assert(
      !String(failure?.error).includes('sup3rSecretPW'),
      'Test 19b: SecretRedactionPolicy sanitizes the thrown error before it reaches the model',
    );
    assert(
      String(failure?.error).includes('[REDACTED_SECRET]'),
      'Test 19c: Redaction placeholder present in the sanitized message',
    );
  } catch (err: any) {
    assert(false, 'Test 19: Output Rails sanitize thrown errors', err.message);
  }

  console.log(`\n  📊 Step 7 Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Step 7 Unit Tests Failed');
  }
}

if (require.main === module) {
  runAgentExecutorTests().catch(() => process.exit(1));
}
