import * as assert from 'node:assert';
import * as crypto from 'node:crypto';
import { GitHubSignatureGuard } from '../src/guards/github-signature.guard';
import { CollaboratorGuard } from '../src/guards/collaborator.guard';
import { ContextPruner } from '../src/ingestion/context-pruner';
import { UCurvePromptAssembler } from '../src/context/u-curve-prompt-assembler';
import { CodebaseRAGService } from '../src/rag/codebase-rag.service';
import { SecurityReviewerAgent } from '../src/agents/security-reviewer.agent';
import { ArchitectureReviewerAgent } from '../src/agents/architecture-reviewer.agent';
import { QualityReviewerAgent } from '../src/agents/quality-reviewer.agent';
import { LeadSynthesizerAgent } from '../src/agents/lead-synthesizer.agent';
import { CodeFixerAgent } from '../src/agents/code-fixer.agent';
import { ConsensusEvaluatorService } from '../src/orchestration/consensus-evaluator.service';
import { PrReviewOrchestrator } from '../src/orchestration/pr-review.orchestrator';
import { ProtectedPathsPolicy } from '../src/policies/protected-paths.policy';
import { RequireMaintainerApprovalPolicy } from '../src/policies/require-maintainer-approval.policy';
import { ReviewQualityEvaluatorService } from '../src/evaluation/review-quality-evaluator.service';
import { NjentExperienceService } from '../src/memory/experience-learner.service';
import { NjentAuditLogger } from '../src/audit/njent-audit-logger.service';
import { ApprovalService, InMemoryApprovalStore, AgentRunner } from 'nestjs-agentic';
import type { AgentContext, PendingApproval } from 'nestjs-agentic';
import type { ReviewAssessment } from '../src/agents/schemas/review-output.schema';

const mockContext: AgentContext = {
  sessionId: 'sess_e2e_001',
  traceId: 'tr_e2e_otel',
  security: {
    userId: 'njent-e2e',
    tenantId: 'irzix',
    roles: ['agent'],
    permissions: ['write'],
  },
};

async function runNjentE2ESuite() {
  console.log('===============================================================');
  console.log('🚀 RUNNING NJENT FLAGSHIP E2E INTEGRATION & VERIFICATION SUITE');
  console.log('===============================================================\n');

  // ==========================================================
  // STAGE 1: INGRESS, SECURITY & DIFF SANITIZATION
  // ==========================================================
  console.log('▶️ Stage 1: Ingress Security, HMAC & Context Pruning...');
  const webhookSecret = 'prod-webhook-secret';
  const sigGuard = new GitHubSignatureGuard(webhookSecret);
  const rawPayload = JSON.stringify({
    action: 'opened',
    pull_request: { number: 42 },
    repository: { full_name: 'irzix/nestjs-agentic' },
    sender: { login: 'irzix' },
  });

  const validHmac = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(rawPayload).digest('hex');
  const mockReq = { body: JSON.parse(rawPayload), headers: { 'x-hub-signature-256': validHmac } };
  const mockExecContext: any = { switchToHttp: () => ({ getRequest: () => mockReq }) };

  assert.strictEqual(sigGuard.canActivate(mockExecContext), true, 'HMAC signature verification failed');

  const collabGuard = new CollaboratorGuard({ allowedUsers: ['irzix', 'maintainer'] });
  assert.strictEqual(await collabGuard.canActivate(mockExecContext), true, 'Collaborator check failed');

  const rawDiff = `diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,1 +1,1 @@
-lock
+lock
diff --git a/src/orders/refund.service.ts b/src/orders/refund.service.ts
--- a/src/orders/refund.service.ts
+++ b/src/orders/refund.service.ts
@@ -1,10 +1,15 @@
 import { Injectable } from '@nestjs/common';
+import { RefundLimitPolicy } from './refund-limit.policy';

 @Injectable()
+export class RefundService {
+  constructor(private readonly policy: RefundLimitPolicy) {}
+  async process(amount: number) { return { amount }; }
+}
`;

  const { prunedDiff, ignoredFiles } = ContextPruner.pruneDiff(rawDiff);
  assert.ok(!prunedDiff.includes('package-lock.json'), 'Lockfile was not pruned');
  assert.ok(prunedDiff.includes('RefundService'), 'Target file diff was lost');
  assert.strictEqual(ignoredFiles[0], 'package-lock.json');
  console.log('  ✅ Ingress HMAC validated, collaborator authorized, lockfiles pruned.');

  // ==========================================================
  // STAGE 2: AST CODEBASE RAG & GRAPH DEPENDENCY EXTRACTION
  // ==========================================================
  console.log('\n▶️ Stage 2: AST Codebase RAG & Graph Dependencies...');
  const ragService = new CodebaseRAGService();
  const indexedChunks = await ragService.ingestCodebase([
    {
      filePath: 'src/orders/refund-limit.policy.ts',
      content: `
export class RefundLimitPolicy {
  evaluate(amount: number) { return amount > 500 ? 'require_approval' : 'allow'; }
}
`,
    },
    {
      filePath: 'src/orders/refund.service.ts',
      content: `
import { RefundLimitPolicy } from './refund-limit.policy';
export class RefundService {
  constructor(private readonly policy: RefundLimitPolicy) {}
}
`,
    },
  ]);

  assert.ok(indexedChunks >= 2, 'AST chunks should be indexed');
  const retrievedContext = await ragService.retrieveContext('RefundLimitPolicy');
  assert.ok(retrievedContext.some((c) => c.includes('RefundLimitPolicy')));
  console.log(`  ✅ Ingested ${indexedChunks} AST chunks and retrieved dependency context.`);

  // ==========================================================
  // STAGE 3: MULTI-AGENT REVIEW FAN-OUT & CONSENSUS SCORING
  // ==========================================================
  console.log('\n▶️ Stage 3: Multi-Agent Orchestration & Consensus Evaluation...');
  const leadSynthesizer = new LeadSynthesizerAgent();
  const consensusEvaluator = new ConsensusEvaluatorService();
  const orchestrator = new PrReviewOrchestrator(ragService, leadSynthesizer, consensusEvaluator);

  const mockSpecialistFindings: ReviewAssessment[] = [
    {
      reviewerName: 'SecurityReviewer',
      category: 'security',
      score: 0.95,
      passed: true,
      summary: 'No secret leakage or SQL injection.',
      issues: [],
      strengths: ['Enforces authorization policy on refunds'],
    },
    {
      reviewerName: 'ArchitectureReviewer',
      category: 'architecture',
      score: 0.92,
      passed: true,
      summary: 'NestJS DI constructor injection verified.',
      issues: [],
      strengths: ['Uses injectable RefundLimitPolicy cleanly'],
    },
    {
      reviewerName: 'QualityReviewer',
      category: 'quality',
      score: 0.90,
      passed: true,
      summary: 'TypeScript strict typing adhered to.',
      issues: [],
      strengths: ['Clear method signatures'],
    },
  ];

  const reviewReport = await orchestrator.executeReview({
    rawDiff,
    triggerEvent: {
      eventType: 'pr_opened',
      repoFullName: 'irzix/nestjs-agentic',
      prNumber: 42,
      author: 'irzix',
      action: 'review',
      headSha: 'sha_head',
      baseSha: 'sha_base',
      timestamp: new Date().toISOString(),
    },
    mockAssessments: mockSpecialistFindings,
  });

  assert.strictEqual(reviewReport.overallStatus, 'APPROVED');
  assert.ok(reviewReport.overallScore >= 0.90);
  assert.ok(reviewReport.consensusScore >= 0.95);
  console.log(`  ✅ Multi-Agent review synthesized: ${reviewReport.overallStatus} (Score: ${reviewReport.overallScore}, Consensus: ${reviewReport.consensusScore}).`);

  // ==========================================================
  // STAGE 4: QUALITY GATE & PAIRWISE DEBIASED JUDGE
  // ==========================================================
  console.log('\n▶️ Stage 4: Quality Gate & MT-Bench Debiased Judge...');
  const qualityEvaluator = new ReviewQualityEvaluatorService();
  const debiasedEval = await qualityEvaluator.evaluateDebiased(
    'Review PR diff for orders',
    reviewReport.summaryMarkdown,
    'Plain text unformatted review',
  );

  assert.strictEqual(debiasedEval.winner, 'candidate_a');
  assert.ok(debiasedEval.confidence >= 0.85);
  console.log(`  ✅ Quality gate passed: Pairwise debiased score = ${debiasedEval.debiasedScoreA} vs ${debiasedEval.debiasedScoreB}.`);

  // ==========================================================
  // STAGE 5: AUTOMATED FIXES & GOVERNANCE HITL CHECKPOINTS
  // ==========================================================
  console.log('\n▶️ Stage 5: Governance Policies & Human-in-the-Loop Settlement...');
  const protectedPolicy = new ProtectedPathsPolicy();
  const approvalPolicy = new RequireMaintainerApprovalPolicy();

  // Test policy denial on CI workflow
  const ciBlock = await protectedPolicy.evaluate(mockContext, 'git_create_branch_and_commit', {
    filePath: '.github/workflows/deploy.yml',
  });
  assert.strictEqual(ciBlock.decision, 'deny');

  // Test approval suspension on fix branch creation
  const branchApproval = await approvalPolicy.evaluate(mockContext, 'git_create_branch_and_commit', {
    branchName: 'njent/fix-refund-limits',
    filePath: 'src/orders/refund.service.ts',
  });
  assert.strictEqual(branchApproval.decision, 'require_approval');

  // Settle approval via ApprovalStore and resume
  const approvalStore = new InMemoryApprovalStore();
  const mockRunner = {
    settleApproval: async () => ({
      success: true,
      output: 'Branch created and patch committed after maintainer authorization.',
      toolCalls: [],
      turns: 1,
    }),
  } as unknown as AgentRunner;

  const approvalService = new ApprovalService(approvalStore, mockRunner);
  const pendingRecord: PendingApproval = {
    id: 'appr_e2e_999',
    agentName: 'code-fixer',
    toolName: 'git_create_branch_and_commit',
    args: { branchName: 'njent/fix-refund-limits' },
    context: mockContext,
    reason: branchApproval.reason || 'Requires approval',
    createdAt: new Date(),
  };

  await approvalStore.save(pendingRecord);
  const settled = await approvalService.approve('appr_e2e_999', {
    actor: { userId: 'maintainer_irzix', label: 'maintainer' },
  });

  assert.ok(settled);
  console.log('  ✅ Protected files defended, mutating action suspended & successfully settled by maintainer.');

  // ==========================================================
  // STAGE 6: EXPERIENCE LEARNING & OPENTELEMETRY AUDIT
  // ==========================================================
  console.log('\n▶️ Stage 6: Cognitive Memory Feedback & OpenTelemetry Tracing...');
  const experienceService = new NjentExperienceService();
  await experienceService.recordMaintainerFeedback(
    'Allow custom @UsePermissions decorator without flagging missing guards',
    'security',
    'irzix/nestjs-agentic',
  );

  const recalledLessons = await experienceService.getRelevantLessons('security');
  assert.ok(recalledLessons.some((l) => l.includes('@UsePermissions')));

  const auditLogger = new NjentAuditLogger();
  const auditEvent = auditLogger.logReviewCompleted({
    sessionId: mockContext.sessionId,
    traceId: mockContext.traceId,
    repo: 'irzix/nestjs-agentic',
    prNumber: 42,
    report: reviewReport,
    durationMs: 1250,
  });

  assert.strictEqual(auditEvent['event'], 'gen_ai.agent.review_completed');
  assert.strictEqual(auditEvent['vcs.pull_request.number'], 42);
  console.log('  ✅ Experience feedback preserved in memory, OpenTelemetry audit event published.');

  console.log('\n===============================================================');
  console.log('🎉 ALL 6 STAGES OF NJENT E2E VERIFICATION PASSED SUCCESSFULLY!');
  console.log('===============================================================\n');
}

runNjentE2ESuite().catch((err) => {
  console.error('❌ Njent E2E suite failed:', err);
  process.exit(1);
});
