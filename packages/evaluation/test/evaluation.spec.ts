import 'reflect-metadata';
import {
  Agent,
  AgentRunner,
  InMemoryApprovalStore,
  LocalToolProvider,
  ToolDiscoveryService,
} from '@nestjs-agentic/core';
import {
  AccuracyGroundTruthMetric,
  BenchmarkRunner,
  EfficiencyMetric,
  EvalReporter,
  LLMAsAJudgeMetric,
  SafetyPolicyMetric,
} from '../src';

export async function runEvaluationTests() {
  console.log('🧪 Running @nestjs-agentic/evaluation Unit Tests...\n');

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

  // Setup Agent Provider & AgentRunner
  function createAgent(name: string) {
    @Agent({ name, description: name })
    class EvalTestAgent {
      define() {
        return { name, instructions: 'Evaluation Test Agent', tools: [] };
      }
    }
    return new EvalTestAgent();
  }

  const agentInstance = createAgent('banking-agent');
  const discovery = new ToolDiscoveryService();
  const store = new InMemoryApprovalStore();
  const mockModuleRef = { get: () => null } as any;

  const localToolProvider = new LocalToolProvider([], store, discovery, mockModuleRef);

  const mockAdapter = {
    async execute(input: any) {
      if (input.message.includes('forbidden')) {
        return {
          sessionId: input.sessionId,
          output: 'Attempted forbidden tool execution',
          toolCalls: [{ toolName: 'deleteDatabase', args: {}, result: { success: false } }],
        };
      }
      return {
        sessionId: input.sessionId,
        output: 'Transfer of $500 to account ACC-2 completed successfully.',
        toolCalls: [{ toolName: 'transferFunds', args: { amount: 500 }, result: { success: true } }],
      };
    },
  };

  const runner = new AgentRunner(
    [agentInstance],
    mockAdapter as any,
    { defaultModel: { provider: 'mock', model: 'mock-model' } },
    localToolProvider,
    mockModuleRef,
  );

  // TEST 1: Metric Evaluators
  try {
    const safety = new SafetyPolicyMetric();
    const accuracy = new AccuracyGroundTruthMetric(0.5);
    const efficiency = new EfficiencyMetric();

    const datasetItem = {
      id: 'item_1',
      query: 'Transfer $500 to ACC-2',
      expectedOutput: 'Transfer completed successfully',
      forbiddenTools: ['deleteDatabase'],
      maxAllowedSteps: 3,
    };

    const agentResult = {
      sessionId: 'sess_eval_1',
      output: 'Transfer of $500 to account ACC-2 completed successfully.',
      toolCalls: [{ toolName: 'transferFunds', args: {}, result: { success: true } }],
    };

    const safetyRes = safety.evaluate(datasetItem, agentResult);
    const accuracyRes = accuracy.evaluate(datasetItem, agentResult);
    const effRes = efficiency.evaluate(datasetItem, agentResult);

    assert(safetyRes.passed === true, 'Test 1a: SafetyPolicyMetric passed for compliant tool call');
    assert(accuracyRes.passed === true, 'Test 1b: AccuracyGroundTruthMetric matched key ground truth terms');
    assert(effRes.passed === true, 'Test 1c: EfficiencyMetric passed step count limit');
  } catch (err: any) {
    assert(false, 'Test 1: Metric Evaluators', err.message);
  }

  // TEST 2: LLMAsAJudgeMetric
  try {
    const judge = new LLMAsAJudgeMetric(async (item, res) => ({
      score: 0.95,
      reason: 'Output is highly helpful and accurate',
    }));

    const datasetItem = { id: 'item_2', query: 'Check balance' };
    const agentResult = { sessionId: 'sess_eval_2', output: 'Balance is $1,500', toolCalls: [] };

    const judgeRes = await judge.evaluate(datasetItem, agentResult);
    assert(judgeRes.passed === true, 'Test 2a: LLMAsAJudgeMetric evaluated output score');
    assert(judgeRes.score === 0.95, 'Test 2b: LLMAsAJudgeMetric returned 0.95 score');
  } catch (err: any) {
    assert(false, 'Test 2: LLMAsAJudgeMetric', err.message);
  }

  // TEST 3: BenchmarkRunner Suite Execution
  try {
    const benchRunner = new BenchmarkRunner(runner);
    const dataset = [
      {
        id: '1',
        query: 'Transfer $500',
        expectedOutput: 'Transfer completed',
      },
      {
        id: '2',
        query: 'Execute forbidden operation',
        forbiddenTools: ['deleteDatabase'],
      },
    ];

    const summary = await benchRunner.runBenchmark('banking-agent', dataset);

    assert(summary.totalItems === 2, 'Test 3a: BenchmarkRunner executed all dataset items');
    assert(summary.itemResults.length === 2, 'Test 3b: BenchmarkRunner compiled item results');

    const reportMd = EvalReporter.generateMarkdownReport(summary);
    assert(reportMd.includes('Benchmark Report'), 'Test 3c: EvalReporter generated markdown report');
  } catch (err: any) {
    assert(false, 'Test 3: BenchmarkRunner Suite Execution', err.message);
  }

  console.log(`\n  📊 Evaluation Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Evaluation Unit Tests Failed');
  }
}

if (require.main === module) {
  runEvaluationTests().catch(() => process.exit(1));
}
