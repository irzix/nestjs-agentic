import {
  EpisodicMemory,
  GenerativeMemoryStore,
  ExperienceLearner,
  ReflectionEngine,
} from '../src';

export async function runExperienceTests() {
  console.log('🧪 Running @nestjs-agentic/memory Experience & Reflexion Tests...\n');

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

  // TEST 1: Clean Execution Trajectory
  try {
    const engine = new ReflectionEngine();
    const result = await engine.critiqueTrajectory({
      sessionId: 'sess_1',
      agentName: 'build-agent',
      goal: 'Compile TypeScript',
      success: true,
      steps: [{ stepIndex: 1, toolName: 'tscBuild', result: { success: true } }],
    });

    assert(result.success === true, 'Test 1a: Clean execution returns success: true');
    assert(result.lessonsLearned.length === 0, 'Test 1b: No lessons learned for successful run');
  } catch (err: unknown) {
    assert(false, 'Test 1: Clean Execution', (err as Error).message);
  }

  // TEST 2: Reflexion Critique on Tool Failure (npm -> pnpm)
  try {
    const engine = new ReflectionEngine();
    const result = await engine.critiqueTrajectory({
      sessionId: 'sess_2',
      agentName: 'package-agent',
      goal: 'Install packages',
      success: false,
      steps: [
        {
          stepIndex: 1,
          toolName: 'executeCommand',
          error: 'npm ERR! lockfile mismatch, use pnpm add instead',
        },
      ],
    });

    assert(result.success === false, 'Test 2a: Failed execution returns success: false');
    assert(result.lessonsLearned.length === 1, 'Test 2b: Lesson learned extracted from error');
    assert(
      result.lessonsLearned[0].includes('pnpm'),
      'Test 2c: Lesson correctly advises pnpm over npm',
    );
  } catch (err: unknown) {
    assert(false, 'Test 2: Reflexion Critique', (err as Error).message);
  }

  // TEST 3: ExperienceLearner Recording & Retrieval
  try {
    const learner = new ExperienceLearner();
    await learner.recordLesson({
      id: 'exp_01',
      agentName: 'finance-agent',
      taskTrigger: 'Financial Transfer',
      pattern: 'High Amount Approval Required',
      lesson: 'Always verify manager approval role for transfers > $10,000',
    });

    const retrieved = await learner.recallLessons('Financial Transfer');
    assert(retrieved.length === 1, 'Test 3a: Experience record saved and retrieved');
    assert(
      retrieved[0].lesson.includes('$10,000'),
      'Test 3b: Retrieved lesson content matches',
    );
  } catch (err: unknown) {
    assert(false, 'Test 3: ExperienceLearner Recording & Retrieval', (err as Error).message);
  }

  // TEST 4: Prompt Guidance Generation
  try {
    const learner = new ExperienceLearner();
    await learner.recordLesson({
      id: 'exp_02',
      agentName: 'dev-agent',
      taskTrigger: 'Database Migration',
      pattern: 'Lock Timeout',
      lesson: 'Run database migrations during maintenance window',
    });

    const guidance = await learner.buildGuidancePrompt('Database Migration');
    assert(
      guidance.includes('Historical Trajectory Guidance'),
      'Test 4a: Formatted prompt guidance header present',
    );
    assert(
      guidance.includes('maintenance window'),
      'Test 4b: Guidance contains learned lesson rule',
    );
  } catch (err: unknown) {
    assert(false, 'Test 4: Prompt Guidance Generation', (err as Error).message);
  }

  // TEST 5: Integration with EpisodicMemory
  try {
    const memory = new EpisodicMemory();
    const learner = new ExperienceLearner({ memoryStore: memory });

    await learner.critiqueTrajectory({
      sessionId: 'sess_mem_exp',
      agentName: 'security-agent',
      goal: 'API Authentication',
      success: false,
      steps: [
        {
          stepIndex: 1,
          toolName: 'loginUser',
          error: 'Rate limit exceeded: 429 Too Many Requests',
        },
      ],
    });

    const guidance = await learner.buildGuidancePrompt('API Authentication', 'sess_mem_exp');
    assert(
      guidance.includes('Throttle tool calls'),
      'Test 5a: ExperienceLearner integrated with memory store recorded & retrieved lesson',
    );
  } catch (err: unknown) {
    assert(false, 'Test 5: Memory Integration', (err as Error).message);
  }

  // TEST 6: Severity-based Cognitive Importance Scoring
  try {
    const engine = new ReflectionEngine();
    const secResult = await engine.critiqueTrajectory({
      sessionId: 'sess_sec',
      agentName: 'auth-agent',
      goal: 'Delete production database',
      success: false,
      steps: [
        {
          stepIndex: 1,
          toolName: 'dropTable',
          error: 'Unauthorized: missing finance_officer permission role',
        },
      ],
    });
    assert(secResult.importance === 0.95, 'Test 6a: Security authorization violation yields importance 0.95');

    const envResult = await engine.critiqueTrajectory({
      sessionId: 'sess_env',
      agentName: 'ci-agent',
      goal: 'Install packages',
      success: false,
      steps: [
        {
          stepIndex: 1,
          toolName: 'exec',
          error: 'npm ERR! peer dependency mismatch, use pnpm instead',
        },
      ],
    });
    assert(envResult.importance === 0.70, 'Test 6b: Package manager mismatch yields importance 0.70');
  } catch (err: unknown) {
    assert(false, 'Test 6: Severity Importance Scoring', (err as Error).message);
  }

  // TEST 7: ExperienceLearner with GenerativeMemoryStore Tri-Factor Decay
  try {
    const generativeStore = new GenerativeMemoryStore();
    const learner = new ExperienceLearner({ memoryStore: generativeStore });

    await learner.critiqueTrajectory({
      sessionId: 'sess_tri_exp',
      agentName: 'gov-agent',
      goal: 'Execute Wire Transfer',
      success: false,
      steps: [
        {
          stepIndex: 1,
          toolName: 'transfer',
          error: 'Unauthorized: finance_officer role required',
        },
      ],
    });

    const guidance = await learner.buildGuidancePrompt('Wire Transfer', 'sess_tri_exp');
    assert(
      guidance.includes('finance_officer'),
      'Test 7a: Tri-Factor GenerativeMemoryStore retrieves high-importance lesson',
    );
  } catch (err: unknown) {
    assert(false, 'Test 7: GenerativeMemoryStore Integration', (err as Error).message);
  }

  // TEST 8: Configurable Severity Weights and Custom Classifier Hook
  try {
    const customEngine = new ReflectionEngine({
      severityWeights: {
        securityAndAuth: 0.99,
      },
      customClassifier: (step, errDetail) => {
        if (errDetail.includes('custom_compliance_violation')) {
          return 0.88;
        }
        return undefined;
      },
    });

    const customSecResult = await customEngine.critiqueTrajectory({
      sessionId: 'sess_custom_sec',
      agentName: 'custom-sec-agent',
      goal: 'Admin operation',
      success: false,
      steps: [{ stepIndex: 1, toolName: 'adminTool', error: 'Unauthorized access' }],
    });
    assert(customSecResult.importance === 0.99, 'Test 8a: Custom configured severity weight (0.99) applied');

    const customHookResult = await customEngine.critiqueTrajectory({
      sessionId: 'sess_hook',
      agentName: 'compliance-agent',
      goal: 'Audit report',
      success: false,
      steps: [{ stepIndex: 1, toolName: 'auditTool', error: 'Failed: custom_compliance_violation detected' }],
    });
    assert(customHookResult.importance === 0.88, 'Test 8b: Custom classifier hook score (0.88) applied');
  } catch (err: unknown) {
    assert(false, 'Test 8: Configurable Severity & Custom Hook', (err as Error).message);
  }

  // TEST 9: Success Trajectory Best Practice Recording
  try {
    const learner = new ExperienceLearner();
    await learner.recordBestPractice(
      'Docker Build',
      'Use multi-stage Docker build to keep images under 150MB',
      { importance: 0.75 },
    );

    const lessons = await learner.recallLessons('Docker Build');
    assert(lessons.length === 1, 'Test 9a: Best practice record saved');
    assert(lessons[0].importance === 0.75, 'Test 9b: Best practice importance preserved');
    assert(lessons[0].pattern === 'Successful Execution Pattern', 'Test 9c: Pattern is marked as successful');
  } catch (err: unknown) {
    assert(false, 'Test 9: Success Trajectory Best Practice', (err as Error).message);
  }

  if (failed > 0) {
    throw new Error('Experience Unit Tests Failed');
  }

  console.log(`\n🎉 All ${passed} Experience & Reflexion tests passed successfully.\n`);
}
