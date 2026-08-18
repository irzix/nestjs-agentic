import * as assert from 'node:assert';
import { ConsensusEvaluatorService } from '../src/orchestration/consensus-evaluator.service';
import { PrReviewOrchestrator } from '../src/orchestration/pr-review.orchestrator';
import { CodebaseRAGService } from '../src/rag/codebase-rag.service';
import { LeadSynthesizerAgent } from '../src/agents/lead-synthesizer.agent';
import type { ReviewAssessment } from '../src/agents/schemas/review-output.schema';

async function runTask04Tests() {
  console.log('🧪 Running Njent Task 04: Multi-Agent Orchestration & Consensus Tests...\n');

  const consensusEvaluator = new ConsensusEvaluatorService();

  // Test 1: High Consensus (Unanimous reviews)
  const highConsensusReviews: ReviewAssessment[] = [
    { reviewerName: 'Sec', category: 'security', score: 0.95, passed: true, summary: '', issues: [], strengths: [] },
    { reviewerName: 'Arch', category: 'architecture', score: 0.92, passed: true, summary: '', issues: [], strengths: [] },
    { reviewerName: 'Qual', category: 'quality', score: 0.90, passed: true, summary: '', issues: [], strengths: [] },
  ];

  const highResult = consensusEvaluator.evaluateConsensus(highConsensusReviews);
  assert.ok(highResult.consensusScore >= 0.95, `Consensus score should be >= 0.95, got ${highResult.consensusScore}`);
  assert.strictEqual(highResult.isHighAgreement, true);
  assert.strictEqual(highResult.divergentReviewers.length, 0);
  console.log(`  ✅ PASS: Test 1: High consensus calculated (${highResult.consensusScore})`);

  // Test 2: Low Consensus (Highly divergent reviews)
  const divergentReviews: ReviewAssessment[] = [
    { reviewerName: 'Sec', category: 'security', score: 1.0, passed: true, summary: '', issues: [], strengths: [] },
    { reviewerName: 'Arch', category: 'architecture', score: 0.10, passed: false, summary: '', issues: [], strengths: [] },
  ];

  const lowResult = consensusEvaluator.evaluateConsensus(divergentReviews);
  assert.ok(lowResult.consensusScore < 0.80, `Consensus should be < 0.80 for 1.0 vs 0.10, got ${lowResult.consensusScore}`);
  assert.strictEqual(lowResult.isHighAgreement, false);
  assert.strictEqual(lowResult.divergentReviewers.length, 2);
  console.log(`  ✅ PASS: Test 2: Divergence detected with degraded consensus (${lowResult.consensusScore})`);

  // Test 3: End-to-End Orchestrator Run
  const ragService = new CodebaseRAGService();
  const leadSynthesizer = new LeadSynthesizerAgent();
  const orchestrator = new PrReviewOrchestrator(ragService, leadSynthesizer, consensusEvaluator);

  const rawDiff = `diff --git a/src/orders/orders.service.ts b/src/orders/orders.service.ts
--- a/src/orders/orders.service.ts
+++ b/src/orders/orders.service.ts
@@ -1,5 +1,5 @@
+export class OrderService { ... }
`;

  const report = await orchestrator.executeReview({
    rawDiff,
    triggerEvent: {
      eventType: 'pr_opened',
      repoFullName: 'irzix/nestjs-agentic',
      prNumber: 99,
      author: 'contributor',
      action: 'review',
      headSha: 'abc',
      baseSha: 'def',
      timestamp: new Date().toISOString(),
    },
    architecturalRules: ['Enforce DI'],
  });

  assert.strictEqual(report.overallStatus, 'APPROVED');
  assert.ok(report.overallScore >= 0.85);
  assert.ok(report.summaryMarkdown.includes('APPROVED'));
  assert.ok(report.specialistScores['SecurityReviewer'] === 0.95);
  console.log('  ✅ PASS: Test 3: Orchestrator executed full review pipeline and synthesized report');

  console.log('\n🎉 All 3 Task 04 Orchestration tests passed successfully!\n');
}

runTask04Tests().catch((err) => {
  console.error('❌ Task 04 tests failed:', err);
  process.exit(1);
});
