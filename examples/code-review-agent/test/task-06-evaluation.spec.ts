import * as assert from 'node:assert';
import { ReviewQualityEvaluatorService } from '../src/evaluation/review-quality-evaluator.service';
import { GitHubTools } from '../src/tools/github-octokit.tools';
import type { AgentContext } from 'nestjs-agentic';
import type { InlineReviewIssue } from '../src/agents/schemas/review-output.schema';

const mockContext: AgentContext = {
  sessionId: 'sess_test',
  traceId: 'tr_test_eval',
  security: {
    userId: 'njent-evaluator',
    tenantId: 'irzix',
    roles: ['agent'],
    permissions: ['write'],
  },
};

async function runTask06Tests() {
  console.log('🧪 Running Njent Task 06: Evaluation Quality Gates & Tools Tests...\n');

  const evaluator = new ReviewQualityEvaluatorService();

  // Test 1: Diff Boundary Validation
  const validDiffLines = new Map<string, Set<number>>([
    ['src/orders/orders.service.ts', new Set([10, 11, 12, 13, 14])],
  ]);

  const candidateIssues: InlineReviewIssue[] = [
    {
      filePath: 'src/orders/orders.service.ts',
      line: 12,
      category: 'security',
      severity: 'high',
      title: 'Valid line issue',
      description: 'Found issue on line 12',
    },
    {
      filePath: 'src/orders/orders.service.ts',
      line: 999, // Hallucinated line
      category: 'quality',
      severity: 'low',
      title: 'Hallucinated line',
      description: 'Line 999 does not exist in diff',
    },
  ];

  const validationResult = evaluator.validateDiffBoundaries(candidateIssues, validDiffLines);
  assert.strictEqual(validationResult.validIssues.length, 1);
  assert.strictEqual(validationResult.validIssues[0].line, 12);
  assert.strictEqual(validationResult.droppedIssues.length, 1);
  assert.strictEqual(validationResult.droppedIssues[0].line, 999);
  console.log('  ✅ PASS: Test 1: Hallucinated line references dropped by DiffBoundaryValidator');

  // Test 2: Pairwise Debiased Judge
  const debiasedResult = await evaluator.evaluateDebiased(
    'Review prompt query',
    'Candidate A formatted with `code blocks` and action items',
    'Candidate B plain text response without backticks',
  );

  assert.strictEqual(debiasedResult.winner, 'candidate_a');
  assert.ok(debiasedResult.debiasedScoreA > debiasedResult.debiasedScoreB);
  assert.ok(debiasedResult.confidence >= 0.85);
  console.log(`  ✅ PASS: Test 2: Pairwise debiased evaluation executed (Score A: ${debiasedResult.debiasedScoreA}, Score B: ${debiasedResult.debiasedScoreB})`);

  // Test 3: GitHub Tools Toolset
  const githubTools = new GitHubTools();
  const diffResult = await githubTools.fetchPrDiff('irzix/nestjs-agentic', 42, mockContext);
  assert.strictEqual(diffResult.prNumber, 42);
  assert.ok(diffResult.diff.includes('diff --git'));

  const commentResult = await githubTools.postInlineReviewComment(
    'src/orders/orders.service.ts',
    12,
    'Please validate amount > 0',
    mockContext,
  );
  assert.strictEqual(commentResult.success, true);
  assert.strictEqual(commentResult.line, 12);
  console.log('  ✅ PASS: Test 3: GitHubTools executed fetch diff and post comment');

  console.log('\n🎉 All 3 Task 06 Evaluation & Tools tests passed successfully!\n');
}

runTask06Tests().catch((err) => {
  console.error('❌ Task 06 tests failed:', err);
  process.exit(1);
});
