import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AgentRunner, ApprovalService, MODEL_ADAPTER } from 'nestjs-agentic';
import type { AgentStreamEvent } from 'nestjs-agentic';
import { AppModule } from '../src/app.module';
import { OrderService } from '../src/order/order.service';
import { SupportController } from '../src/support/support.controller';
import { createModelAdapter } from '../src/model.factory';
import { ScriptedOpenAi } from './openai-fetch.stub';

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

/**
 * Boots the real application module and replaces only the model adapter, so the
 * governed tool path, NestJS wiring, and OpenAI request translation are all
 * exercised end to end without contacting a provider.
 */
async function bootstrap(script: ScriptedOpenAi) {
  return Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MODEL_ADAPTER)
    .useValue(createModelAdapter({ maxRetries: 0, clientOptions: { fetch: script.fetch as any } }))
    .compile();
}

async function main() {
  console.log('🎧 Running Customer Support Example End-to-End Tests...\n');

  // TEST 1: Multi-round tool loop against the OpenAI wire format
  try {
    const script = new ScriptedOpenAi()
      .callTools([{ name: 'getOrder', args: { orderId: '456' } }])
      .callTools([{ name: 'refundOrder', args: { orderId: '456', amount: 200 } }])
      .reply('Order 456 was refunded $200.');

    const moduleRef = await bootstrap(script);
    const controller = moduleRef.get(SupportController, { strict: false });
    const orders = moduleRef.get(OrderService, { strict: false });

    const result = await controller.chat({
      sessionId: 'sess_e2e_1',
      message: 'Refund $200 for order 456',
      userId: 'user-1',
    });

    assert(script.requests.length === 3, 'Test 1a: Three model rounds issued');
    assert(
      script.requests[0].body.messages[0].role === 'system',
      'Test 1b: Agent instructions sent as a system message',
    );
    assert(
      script.requestedTools.includes('getOrder') && script.requestedTools.includes('refundOrder'),
      'Test 1c: Governed tools advertised to the model',
    );
    assert(
      script.requests[1].body.messages.some((m: any) => m.role === 'tool'),
      'Test 1d: Tool results fed back to the model',
    );
    assert(result.toolCalls.length === 2, 'Test 1e: Both tool executions recorded');
    assert(
      (await orders.findById('456'))?.status === 'refunded',
      'Test 1f: Application service actually mutated state',
    );
    assert(
      result.output === 'Order 456 was refunded $200.',
      'Test 1g: Final model answer returned to the caller',
    );

    await moduleRef.close();
  } catch (err: any) {
    assert(false, 'Test 1: Multi-round loop', err.message);
  }

  // TEST 2: Policy holds the refund for approval, then it applies once
  try {
    const script = new ScriptedOpenAi().callTools([
      { name: 'refundOrder', args: { orderId: '123', amount: 600 } },
    ]);

    const moduleRef = await bootstrap(script);
    const controller = moduleRef.get(SupportController, { strict: false });
    const approvals = moduleRef.get(ApprovalService, { strict: false });
    const orders = moduleRef.get(OrderService, { strict: false });

    const result = await controller.chat({
      sessionId: 'sess_e2e_2',
      message: 'Refund $600 for order 123',
      userId: 'user-1',
    });

    const pending = result.toolCalls[0]?.result as any;
    assert(pending?.status === 'pending_approval', 'Test 2a: Refund above $500 requires approval');
    assert(script.requests.length === 1, 'Test 2b: Loop suspended instead of another model round');
    assert(
      (await orders.findById('123'))?.status === 'completed',
      'Test 2c: Side effect withheld before approval',
    );

    const approved = (await controller.approve(pending.approvalId)) as any;
    assert(approved?.success === true, 'Test 2d: Approval executed the pending tool');
    assert(
      (await orders.findById('123'))?.status === 'refunded',
      'Test 2e: Side effect applied after approval',
    );

    let secondApproval: unknown;
    try {
      await approvals.approve(pending.approvalId);
    } catch (err) {
      secondApproval = err;
    }
    assert(secondApproval instanceof Error, 'Test 2f: Approval cannot be replayed');

    await moduleRef.close();
  } catch (err: any) {
    assert(false, 'Test 2: Approval flow', err.message);
  }

  // TEST 3: Security context is enforced by the application service
  try {
    const script = new ScriptedOpenAi()
      .callTools([{ name: 'getOrder', args: { orderId: '123' } }])
      .reply('I could not access that order.');

    const moduleRef = await bootstrap(script);
    const runner = moduleRef.get(AgentRunner, { strict: false });

    let caught: unknown;
    try {
      await runner.run('customer-support', {
        sessionId: 'sess_e2e_3',
        message: 'Show me order 123',
        context: { userId: 'someone-else' },
      });
    } catch (err) {
      caught = err;
    }

    assert(
      caught instanceof Error && String((caught as Error).message).includes('Access denied'),
      'Test 3a: Tool receives the caller identity, not a model-supplied one',
    );

    await moduleRef.close();
  } catch (err: any) {
    assert(false, 'Test 3: Security context', err.message);
  }

  // TEST 4: Incomplete tool arguments never reach the service
  try {
    const script = new ScriptedOpenAi()
      .callTools([{ name: 'refundOrder', args: { orderId: '456' } }])
      .reply('I need the refund amount before I can continue.');

    const moduleRef = await bootstrap(script);
    const runner = moduleRef.get(AgentRunner, { strict: false });
    const orders = moduleRef.get(OrderService, { strict: false });

    const result = await runner.run('customer-support', {
      sessionId: 'sess_e2e_4',
      message: 'Refund order 456',
      context: { userId: 'user-1' },
    });

    assert(result.toolCalls.length === 0, 'Test 4a: Invalid call not executed');
    assert(
      (await orders.findById('456'))?.status === 'completed',
      'Test 4b: Service state untouched by the rejected call',
    );

    const toolMessage = script.requests[1].body.messages.find((m: any) => m.role === 'tool');
    assert(
      String(toolMessage?.content).includes('amount'),
      'Test 4c: Validation problem reported back to the model',
    );
    assert(
      result.output === 'I need the refund amount before I can continue.',
      'Test 4d: Model recovers within the same turn',
    );

    await moduleRef.close();
  } catch (err: any) {
    assert(false, 'Test 4: Argument validation', err.message);
  }

  // TEST 5: Streaming surfaces tokens and governed tool events in order
  try {
    const script = new ScriptedOpenAi()
      .streamReply(['Looking ', 'up ', 'that ', 'order'], [
        { name: 'getOrder', args: { orderId: '456' } },
      ])
      .streamReply(['Order ', '456 ', 'is ', 'completed.']);

    const moduleRef = await bootstrap(script);
    const runner = moduleRef.get(AgentRunner, { strict: false });

    const events: AgentStreamEvent[] = [];
    for await (const event of runner.runStream('customer-support', {
      sessionId: 'sess_e2e_5',
      message: 'Where is order 456?',
      context: { userId: 'user-1' },
    })) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    const tokens = events
      .filter((e): e is Extract<AgentStreamEvent, { type: 'token' }> => e.type === 'token')
      .map((e) => e.text)
      .join('');

    assert(script.requests[0].body.stream === true, 'Test 5a: Streaming requested from the provider');
    assert(tokens.includes('Looking up that order'), 'Test 5b: Provider tokens streamed through');
    assert(
      types.indexOf('tool_start') < types.indexOf('tool_result'),
      'Test 5c: Tool lifecycle events ordered',
    );
    const last = events[events.length - 1];
    assert(
      last.type === 'complete' && last.output === 'Order 456 is completed.',
      'Test 5d: Stream ends with the final answer',
    );

    await moduleRef.close();
  } catch (err: any) {
    assert(false, 'Test 5: Streaming', err.message);
  }

  // TEST 6: Module-level iteration budget stops a looping model
  try {
    const script = new ScriptedOpenAi();
    for (let i = 0; i < 8; i++) {
      script.callTools([{ name: 'getOrder', args: { orderId: '456' } }]);
    }

    const moduleRef = await bootstrap(script);
    const runner = moduleRef.get(AgentRunner, { strict: false });

    let caught: any;
    try {
      await runner.run('customer-support', {
        sessionId: 'sess_e2e_6',
        message: 'Keep checking order 456',
        context: { userId: 'user-1' },
      });
    } catch (err) {
      caught = err;
    }

    assert(caught?.kind === 'max_iterations', 'Test 6a: Iteration budget from forRoot enforced');
    assert(caught?.limit === 6, 'Test 6b: Configured limit reported on the error');
    assert(script.requests.length === 6, 'Test 6c: No further provider calls after the budget');

    await moduleRef.close();
  } catch (err: any) {
    assert(false, 'Test 6: Execution budget', err.message);
  }

  console.log(`\n  📊 Customer Support E2E Results: ${passed} passed, ${failed} failed.\n`);

  if (failed > 0) {
    console.error('❌ TEST SUITE FAILURE: Customer support example tests failed.');
    process.exit(1);
  }

  console.log('🎉 CUSTOMER SUPPORT EXAMPLE TEST SUITE PASSED SUCCESSFULLY!\n');
}

main().catch((err) => {
  console.error('❌ TEST SUITE FAILURE:', err);
  process.exit(1);
});
