import * as assert from 'node:assert';
import { NjentExperienceService } from '../src/memory/experience-learner.service';
import { NjentAuditLogger } from '../src/audit/njent-audit-logger.service';

async function runTask07Tests() {
  console.log('🧪 Running Njent Task 07: Memory, Experience & Observability Tests...\n');

  // Test 1: ExperienceLearner false-positive feedback
  const memoryService = new NjentExperienceService();

  await memoryService.recordMaintainerFeedback(
    'Do not flag @UsePermissions decorator as missing auth guard',
    'security',
    'irzix/nestjs-agentic',
  );

  const lessons = await memoryService.getRelevantLessons('security');
  assert.ok(lessons.length > 0);
  assert.ok(lessons.some((l) => l.includes('@UsePermissions')));
  console.log('  ✅ PASS: Test 1: Maintainer feedback recorded and retrieved from ExperienceLearner');

  // Test 2: Stanford Memory Scorer ($S = w_rec S_rec + w_imp S_imp + w_rel S_rel$)
  const score = memoryService.scoreMemoryItem(
    {
      content: 'Do not flag @UsePermissions decorator',
      importance: 0.9,
      timestamp: new Date(),
    },
    'UsePermissions',
  );

  assert.ok(score >= 0.50 && score <= 1.0, `Stanford score must be in [0.5, 1.0], got ${score}`);
  console.log(`  ✅ PASS: Test 2: StanfordMemoryScorer calculated weighted memory score (${score})`);

  // Test 3: OpenTelemetry GenAI Audit Logger
  const auditLogger = new NjentAuditLogger();
  const logged = auditLogger.logReviewCompleted({
    sessionId: 'sess_99',
    traceId: 'tr_otel_123',
    repo: 'irzix/nestjs-agentic',
    prNumber: 99,
    report: {
      overallStatus: 'APPROVED',
      overallScore: 0.95,
      consensusScore: 0.98,
      summaryMarkdown: 'Looks great',
      specialistScores: { Sec: 0.95 },
      inlineIssues: [],
    },
    durationMs: 1450,
  });

  assert.strictEqual(logged['event'], 'gen_ai.agent.review_completed');
  assert.strictEqual(logged['vcs.pull_request.number'], 99);
  assert.strictEqual(logged['gen_ai.response.status'], 'APPROVED');
  assert.strictEqual(logged['gen_ai.duration_ms'], 1450);
  console.log('  ✅ PASS: Test 3: OpenTelemetry GenAI semantic convention event logged');

  console.log('\n🎉 All 3 Task 07 Memory & Observability tests passed successfully!\n');
}

runTask07Tests().catch((err) => {
  console.error('❌ Task 07 tests failed:', err);
  process.exit(1);
});
