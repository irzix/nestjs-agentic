import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AgentRunner, RUNTIME_ADAPTER } from '@nestjs-agentic/core';
import type { AgentStreamEvent, ToolExecutionResult } from '@nestjs-agentic/core';
import { LangGraphRuntimeAdapter } from '@nestjs-agentic/langgraph';
import { AppModule } from './app.module';

async function runLangGraphTests() {
  process.stdout.write('🌐 Starting LangGraph Workflow Integration Tests...\n');

  let app: any;
  try {
    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    process.stdout.write('✅ App Context Created Successfully\n');
  } catch (err: any) {
    process.stderr.write(`❌ Bootstrap Error: ${err?.stack || err}\n`);
    throw err;
  }

  const runner = app.get(AgentRunner);
  const adapter = app.get(RUNTIME_ADAPTER) as LangGraphRuntimeAdapter;

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      process.stdout.write(`  ✅ PASS: ${testName}\n`);
      passed++;
    } else {
      process.stderr.write(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}\n`);
      failed++;
    }
  }

  // TEST 1: Authorized Tenant Inventory Check
  try {
    const result = await runner.run('inventory-agent', {
      sessionId: 'sess_lg_101',
      message: 'Check stock for SKU-101',
      context: {
        userId: 'usr_warehouse_mgr',
        tenantId: 'tenant_logistics',
      },
    });

    assert(result.sessionId === 'sess_lg_101', 'Test 1a: Returned correct sessionId');
    assert(result.toolCalls.length > 0, 'Test 1b: LangGraph executed inventory tools');

    const checkStockCall = result.toolCalls.find((t: any) => t.toolName === 'checkStock');
    assert(checkStockCall !== undefined, 'Test 1c: checkStock tool executed via LangGraph closure');
    assert(
      (checkStockCall?.result as any)?.data?.availableQty === 150,
      'Test 1d: Inventory quantity 150 returned successfully',
    );
    assert(
      (checkStockCall?.result as any)?.data?.tenantId === 'tenant_logistics',
      'Test 1e: AgentContext tenantId pre-bound into @Context() parameter',
    );
  } catch (err: any) {
    assert(false, 'Test 1: Authorized Tenant Inventory Check', err.message);
  }

  // TEST 2: Suspended Tenant Denied Execution
  try {
    const result = await runner.run('inventory-agent', {
      sessionId: 'sess_lg_102',
      message: 'Check stock for SKU-101',
      context: {
        userId: 'usr_suspended',
        tenantId: 'suspended_tenant',
      },
    });

    const checkStockCall = result.toolCalls.find((t: any) => t.toolName === 'checkStock');
    const res = checkStockCall?.result as ToolExecutionResult;

    assert(
      res?.success === false,
      'Test 2a: Policy decision "deny" returns success: false',
    );
    assert(
      !res?.success && res?.status === 'denied',
      'Test 2b: Execution status is "denied"',
    );
    assert(
      !res?.success && res?.reason.includes('suspended'),
      'Test 2c: Policy evaluation reason contains suspension details',
    );
  } catch (err: any) {
    assert(false, 'Test 2: Suspended Tenant Denied Execution', err.message);
  }

  // TEST 3: Checkpointer Thread State Persistence & Streaming
  try {
    const checkpointer = adapter.getCheckpointer();
    const threadTuple = await checkpointer.getTuple({
      configurable: { thread_id: 'sess_lg_101' },
    });

    assert(
      threadTuple !== undefined && Boolean(threadTuple.checkpoint),
      'Test 3a: Checkpointer stored session thread state snapshot for sess_lg_101',
    );

    const streamEvents: AgentStreamEvent[] = [];
    for await (const event of runner.runStream('inventory-agent', {
      sessionId: 'sess_lg_103_stream',
      message: 'Check stock for SKU-101 via stream',
      context: {
        userId: 'usr_warehouse_mgr',
        tenantId: 'tenant_logistics',
      },
    })) {
      streamEvents.push(event);
    }

    assert(
      streamEvents.length >= 3,
      'Test 3b: LangGraph runStream() emitted structured streaming events',
    );
    assert(
      streamEvents[0].type === 'tool_start',
      'Test 3c: LangGraph emitted "tool_start" stream event',
    );
  } catch (err: any) {
    assert(false, 'Test 3: Checkpointer Persistence & Streaming', err.message);
  }

  process.stdout.write(`\n  📊 Summary: ${passed} passed, ${failed} failed.\n\n`);
  await app.close();

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runLangGraphTests().catch((err) => {
  process.stderr.write(`Fatal Test Failure Stack: ${err?.stack || err}\n`);
  process.exitCode = 1;
});
