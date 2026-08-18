import {
  Agent,
  AgentRunner,
  InMemoryApprovalStore,
  LocalToolProvider,
  ToolDiscoveryService,
} from '@nestjs-agentic/core';
import 'reflect-metadata';
import {
  AccuracyGroundTruthMetric,
  BenchmarkRunner,
  EvalReporter,
  ExecutionEfficiencyMetric,
  LLMAsAJudgeMetric,
  SafetyPolicyMetric,
  TrajectoryInspectorMetric,
} from '../src';
import { runPairwiseJudgeTests } from './pairwise-judge.spec';
import { runTrajectoryMetricsTests } from './trajectory-metrics.spec';


export async function runEvaluationTests() {
  console.log('🧪 Running @nestjs-agentic/evaluation Comprehensive Unit Tests...\n');

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

  // TEST 1: Sørensen-Dice Mathematical Accuracy & Efficiency Metrics
  try {
    const safety = new SafetyPolicyMetric();
    const accuracy = new AccuracyGroundTruthMetric(0.3);
    const efficiency = new ExecutionEfficiencyMetric();

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
    const accuracyRes = await accuracy.evaluate(datasetItem, agentResult);
    const effRes = efficiency.evaluate(datasetItem, agentResult);

    assert(safetyRes.passed === true, 'Test 1a: SafetyPolicyMetric passed for compliant tool call');
    assert(accuracyRes.passed === true, 'Test 1b: AccuracyGroundTruthMetric calculated mathematical Dice coefficient');
    assert(effRes.passed === true, 'Test 1c: ExecutionEfficiencyMetric calculated weighted score');
  } catch (err: any) {
    assert(false, 'Test 1: Metric Evaluators', err.message);
  }

  // TEST 2: TrajectoryInspectorMetric Sequence & Arg Assertions
  try {
    const inspector = new TrajectoryInspectorMetric();
    const item = {
      id: 'item_traj',
      query: 'Transfer funds',
      expectedToolSequence: ['transferFunds'],
      expectedToolArgs: { transferFunds: { amount: 500 } },
    };

    const validResult = {
      sessionId: 's1',
      output: 'Done',
      toolCalls: [{ toolName: 'transferFunds', args: { amount: 500 }, result: { success: true } }],
    };

    const invalidResult = {
      sessionId: 's2',
      output: 'Done',
      toolCalls: [{ toolName: 'transferFunds', args: { amount: 9999 }, result: { success: true } }],
    };

    const validEval = inspector.evaluate(item, validResult);
    const invalidEval = inspector.evaluate(item, invalidResult);

    assert(validEval.passed === true, 'Test 2a: TrajectoryInspectorMetric verified tool sequence & args');
    assert(invalidEval.passed === false, 'Test 2b: TrajectoryInspectorMetric detected arg value mismatch');
  } catch (err: any) {
    assert(false, 'Test 2: TrajectoryInspectorMetric', err.message);
  }

  // TEST 3: LLMAsAJudgeMetric
  try {
    const judge = new LLMAsAJudgeMetric(async (item, res) => ({
      score: 0.95,
      reason: 'Output is highly helpful and accurate',
    }));

    const datasetItem = { id: 'item_2', query: 'Check balance' };
    const agentResult = { sessionId: 'sess_eval_2', output: 'Balance is $1,500', toolCalls: [] };

    const judgeRes = await judge.evaluate(datasetItem, agentResult);
    assert(judgeRes.passed === true, 'Test 3a: LLMAsAJudgeMetric evaluated output score');
    assert(judgeRes.score === 0.95, 'Test 3b: LLMAsAJudgeMetric returned 0.95 score');
  } catch (err: any) {
    assert(false, 'Test 3: LLMAsAJudgeMetric', err.message);
  }

  // TEST 4: BenchmarkRunner Multi-Trial Variance Analysis
  try {
    const benchRunner = new BenchmarkRunner(runner, { trialsPerItem: 3 });
    const dataset = [
      {
        id: '1',
        query: 'Transfer $500',
        expectedOutput: 'Transfer completed',
      },
    ];

    const summary = await benchRunner.runBenchmark('banking-agent', dataset);

    assert(summary.totalItems === 1, 'Test 4a: BenchmarkRunner executed all dataset items');
    assert(summary.itemResults[0].multiTrialSummary?.scores.length === 3, 'Test 4b: Calculated 3 trial scores per item');
    assert(summary.overallVariance >= 0, 'Test 4c: Computed mathematical overall variance');

    const reportMd = EvalReporter.generateMarkdownReport(summary);
    assert(reportMd.includes('Benchmark Report'), 'Test 4d: EvalReporter generated markdown report');
  } catch (err: any) {
    assert(false, 'Test 4: Multi-Trial Variance Analysis', err.message);
  }

  console.log(`\n  📊 Core Evaluation Test Results: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) {
    throw new Error('Evaluation Unit Tests Failed');
  }

  // Run Position-Debiased Judge and Trajectory Efficiency Tests
  await runPairwiseJudgeTests();
  await runTrajectoryMetricsTests();
}
if (require.main === module) {
  runEvaluationTests().catch(() => process.exit(1));
}
