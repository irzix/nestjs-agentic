import type { AgentResult } from '@nestjs-agentic/core';
import {
  ToolPrecisionMetric,
  TrajectoryInspectorMetric,
  type EvalDatasetItem,
  type TrajectoryEfficiencyMetrics,
} from '../src';

export async function runTrajectoryMetricsTests() {
  console.log('📈 Running Trajectory Metrics Tests (AgentBench Efficiency & Precision)...\n');

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

  // 1. ToolPrecisionMetric - 100% Success Rate
  try {
    const metric = new ToolPrecisionMetric({ minPrecisionThreshold: 0.8 });
    const item: EvalDatasetItem = {
      id: 'item_1',
      query: 'Check balance and transfer',
    };
    const result: AgentResult = {
      sessionId: 'sess_1',
      output: 'Done',
      toolCalls: [
        { toolName: 'checkBalance', args: {}, result: { balance: 1000 } },
        { toolName: 'transferFunds', args: { amount: 100 }, result: { success: true } },
      ],
    };

    const evalResult = metric.evaluate(item, result);
    assert(evalResult.passed === true, 'Test 1a: Error-free trajectory passes precision metric');
    assert(evalResult.score === 1.0, 'Test 1b: 100% success rate gives score 1.0');
    assert((evalResult.details as any).successfulCalls === 2, 'Test 1c: 2 successful calls recorded');
  } catch (err: unknown) {
    assert(false, 'Test 1: Perfect Tool Precision', String(err));
  }

  // 2. ToolPrecisionMetric - Handling Tool Execution Failures
  try {
    const metric = new ToolPrecisionMetric({ minPrecisionThreshold: 0.75 });
    const item: EvalDatasetItem = {
      id: 'item_2',
      query: 'Attempt payment',
    };
    const result: AgentResult = {
      sessionId: 'sess_2',
      output: 'Recovered after retry',
      toolCalls: [
        { toolName: 'payInvoice', args: {}, result: new Error('Network timeout') }, // Failure 1
        { toolName: 'payInvoice', args: {}, result: { success: false, reason: 'Insufficient funds' } }, // Failure 2
        { toolName: 'depositFunds', args: {}, result: { success: true } }, // Success 1
        { toolName: 'payInvoice', args: {}, result: { success: true } }, // Success 2
      ],
    };

    const evalResult = metric.evaluate(item, result);
    // 2 successes out of 4 calls = 0.50 precision (below 0.75 threshold)
    assert(evalResult.passed === false, 'Test 2a: Fails when precision is 0.50 < 0.75 threshold');
    assert(evalResult.score === 0.50, 'Test 2b: Calculated precision is exactly 0.50 (2/4)');
    assert((evalResult.details as any).failedCalls === 2, 'Test 2c: 2 failed calls recorded');
    assert((evalResult.details as any).failedTools.length === 2, 'Test 2d: Failed tools list populated');
  } catch (err: unknown) {
    assert(false, 'Test 2: Tool Precision with Failures', String(err));
  }

  // 3. ToolPrecisionMetric - Edge Case: No Tool Calls Required vs Expected
  try {
    const metric = new ToolPrecisionMetric();
    const itemNoTools: EvalDatasetItem = { id: 'i1', query: 'Say hello' };
    const resultNoTools: AgentResult = { sessionId: 's1', output: 'Hello!', toolCalls: [] };

    const noToolEval = metric.evaluate(itemNoTools, resultNoTools);
    assert(noToolEval.passed === true && noToolEval.score === 1.0, 'Test 3a: Zero calls when none required passes with 1.0');

    const itemRequiresTools: EvalDatasetItem = {
      id: 'i2',
      query: 'Delete row',
      expectedToolSequence: ['deleteRow'],
    };
    const missedToolEval = metric.evaluate(itemRequiresTools, resultNoTools);
    assert(missedToolEval.passed === false && missedToolEval.score === 0.0, 'Test 3b: Zero calls when tool was expected fails with 0.0');
  } catch (err: unknown) {
    assert(false, 'Test 3: Zero Calls Edge Cases', String(err));
  }

  // 4. TrajectoryInspectorMetric - Step Efficiency Evaluation (AgentBench)
  try {
    const inspector = new TrajectoryInspectorMetric({ penalizeExtraSteps: true });
    const item: EvalDatasetItem = {
      id: 'item_optimal',
      query: 'Check stock and reserve',
      optimalSteps: 2,
      expectedToolSequence: ['checkStock', 'reserveItem'],
    };

    // Case A: Optimal execution (2 steps executed = 100% step efficiency)
    const optimalResult: AgentResult = {
      sessionId: 's_opt',
      output: 'Item reserved',
      toolCalls: [
        { toolName: 'checkStock', args: {}, result: { inStock: true } },
        { toolName: 'reserveItem', args: {}, result: { reserved: true } },
      ],
    };
    const evalOpt = inspector.evaluate(item, optimalResult);
    const metricsOpt = evalOpt.details as unknown as TrajectoryEfficiencyMetrics;
    assert(evalOpt.passed === true, 'Test 4a: Optimal trajectory passes');
    assert(metricsOpt.stepEfficiency === 1.0, 'Test 4b: Step efficiency is 1.0');
    assert(metricsOpt.isOptimal === true, 'Test 4c: isOptimal is true');

    // Case B: Sub-optimal execution (4 steps executed for 2-step task = 50% step efficiency)
    const bloatedResult: AgentResult = {
      sessionId: 's_bloat',
      output: 'Item reserved after meandering',
      toolCalls: [
        { toolName: 'checkStock', args: {}, result: { inStock: true } },
        { toolName: 'reserveItem', args: {}, result: { reserved: true } },
        { toolName: 'extraLogging', args: {}, result: 'logged' },
        { toolName: 'extraPing', args: {}, result: 'pong' },
      ],
    };
    const evalBloat = inspector.evaluate(item, bloatedResult);
    const metricsBloat = evalBloat.details as unknown as TrajectoryEfficiencyMetrics;
    assert(metricsBloat.stepEfficiency === 0.5, 'Test 4d: Step efficiency is 2/4 = 0.50');
    assert(metricsBloat.isOptimal === false, 'Test 4e: isOptimal is false');
    assert(evalBloat.score < 1.0, 'Test 4f: Score penalized for extra unnecessary steps');
  } catch (err: unknown) {
    assert(false, 'Test 4: Trajectory Step Efficiency', String(err));
  }

  // 5. TrajectoryInspectorMetric - Sequence and Argument Assertions
  try {
    const inspector = new TrajectoryInspectorMetric();
    const item: EvalDatasetItem = {
      id: 'item_seq',
      query: 'Order goods',
      expectedToolSequence: ['validateAddress', 'placeOrder'],
      expectedToolArgs: {
        placeOrder: { sku: 'SKU-999', quantity: 2 },
      },
    };

    // Argument mismatch case
    const badArgsResult: AgentResult = {
      sessionId: 's_bad_args',
      output: 'Ordered',
      toolCalls: [
        { toolName: 'validateAddress', args: {}, result: { valid: true } },
        { toolName: 'placeOrder', args: { sku: 'SKU-999', quantity: 999 }, result: { orderId: 'ord_1' } }, // quantity mismatch!
      ],
    };

    const badArgsEval = inspector.evaluate(item, badArgsResult);
    assert(badArgsEval.passed === false, 'Test 5a: Argument value mismatch fails');
    assert(badArgsEval.score === 0.5, 'Test 5b: Partial score awarded for matching sequence but mismatched arg');
    assert(Boolean(badArgsEval.reason?.includes('quantity')), 'Test 5c: Reason mentions mismatched argument');
  } catch (err: unknown) {
    assert(false, 'Test 5: Argument Assertions', String(err));
  }

  if (failed > 0) {
    throw new Error(`${failed} Trajectory Metrics test(s) failed.`);
  }

  console.log(`\n🎉 All ${passed} Trajectory Metrics tests passed successfully.\n`);
}

if (require.main === module) {
  runTrajectoryMetricsTests().catch(() => process.exit(1));
}
