import * as assert from 'node:assert';
import { SecurityReviewerAgent } from '../src/agents/security-reviewer.agent';
import { ArchitectureReviewerAgent } from '../src/agents/architecture-reviewer.agent';
import { QualityReviewerAgent } from '../src/agents/quality-reviewer.agent';
import { LeadSynthesizerAgent } from '../src/agents/lead-synthesizer.agent';
import { CodeFixerAgent } from '../src/agents/code-fixer.agent';
import type { ReviewAssessment } from '../src/agents/schemas/review-output.schema';

async function runTask03Tests() {
  console.log('🧪 Running Njent Task 03: Specialist Reviewer Agents Tests...\n');

  // Test 1: Agent Provider Definitions
  const secAgent = new SecurityReviewerAgent();
  const archAgent = new ArchitectureReviewerAgent();
  const qualAgent = new QualityReviewerAgent();
  const leadAgent = new LeadSynthesizerAgent();
  const fixerAgent = new CodeFixerAgent();

  assert.ok(secAgent.define().instructions.includes('Security Reviewer'));
  assert.ok(archAgent.define().instructions.includes('Architecture Reviewer'));
  assert.ok(qualAgent.define().instructions.includes('Quality'));
  assert.ok(leadAgent.define().instructions.includes('Lead Synthesizer'));
  assert.ok(fixerAgent.define().instructions.includes('Code Fixer'));
  console.log('  ✅ PASS: Test 1: Specialist agents defined with isolated domain instructions');

  // Test 2: Synthesis with Zero Issues -> APPROVED
  const cleanAssessments: ReviewAssessment[] = [
    { reviewerName: 'SecurityReviewer', category: 'security', score: 1.0, passed: true, summary: 'Clean', issues: [], strengths: ['No secrets'] },
    { reviewerName: 'ArchitectureReviewer', category: 'architecture', score: 0.95, passed: true, summary: 'Good DI', issues: [], strengths: ['Uses DI'] },
    { reviewerName: 'QualityReviewer', category: 'quality', score: 0.90, passed: true, summary: 'Typed', issues: [], strengths: ['Full types'] },
  ];

  const approvedReport = leadAgent.synthesize(cleanAssessments, 0.98);
  assert.strictEqual(approvedReport.overallStatus, 'APPROVED');
  assert.strictEqual(approvedReport.overallScore, 0.95);
  assert.ok(approvedReport.summaryMarkdown.includes('APPROVED'));
  assert.ok(approvedReport.summaryMarkdown.includes('No issues identified'));
  console.log('  ✅ PASS: Test 2: Clean reviews synthesized to APPROVED decision');

  // Test 3: Synthesis with Critical Issue -> CHANGES_REQUESTED
  const flawedAssessments: ReviewAssessment[] = [
    {
      reviewerName: 'SecurityReviewer',
      category: 'security',
      score: 0.40,
      passed: false,
      summary: 'Secret leak detected',
      issues: [
        {
          filePath: 'src/config.ts',
          line: 12,
          category: 'security',
          severity: 'critical',
          title: 'Hardcoded API Key',
          description: 'Found private key in code',
          suggestedFix: 'process.env.SECRET_KEY',
        },
      ],
      strengths: [],
    },
  ];

  const rejectedReport = leadAgent.synthesize(flawedAssessments, 0.70);
  assert.strictEqual(rejectedReport.overallStatus, 'CHANGES_REQUESTED');
  assert.strictEqual(rejectedReport.inlineIssues.length, 1);
  assert.ok(rejectedReport.summaryMarkdown.includes('[CRITICAL]'));
  assert.ok(rejectedReport.summaryMarkdown.includes('Hardcoded API Key'));
  console.log('  ✅ PASS: Test 3: Critical issue synthesized to CHANGES_REQUESTED');

  // Test 4: Code Fixer Patches
  const patches = fixerAgent.generateFixPatches(flawedAssessments[0].issues);
  assert.strictEqual(patches.length, 1);
  assert.ok(patches[0].includes('diff --git a/src/config.ts b/src/config.ts'));
  assert.ok(patches[0].includes('+process.env.SECRET_KEY'));
  console.log('  ✅ PASS: Test 4: CodeFixer generated valid unified git diff patch');

  // Test 5: Issue Deduplication & Score Clamping
  const duplicateIssuesAssessments: ReviewAssessment[] = [
    {
      reviewerName: 'Sec',
      category: 'security',
      score: 1.5, // should clamp to 1.0
      passed: true,
      summary: '',
      issues: [
        { filePath: 'src/app.ts', line: 10, category: 'security', severity: 'high', title: 'Hardcoded Secret', description: 'desc 1', suggestedFix: 'fix1' },
        { filePath: 'src/app.ts', line: 10, category: 'security', severity: 'critical', title: 'Hardcoded Secret', description: 'desc 2' }, // duplicate same category/title, higher severity without fix
        { filePath: 'src/app.ts', line: 10, category: 'architecture', severity: 'medium', title: 'Missing DI', description: 'distinct issue same line' }, // distinct category same line
      ],
      strengths: [],
    },
  ];

  const dedupReport = leadAgent.synthesize(duplicateIssuesAssessments, 1.0);
  assert.strictEqual(dedupReport.inlineIssues.length, 2, 'Should deduplicate exact duplicate but preserve distinct same-line issue');
  assert.strictEqual(dedupReport.inlineIssues[0].severity, 'critical', 'Should retain critical severity');
  assert.strictEqual(dedupReport.inlineIssues[0].suggestedFix, 'fix1', 'Should retain suggestedFix from merged duplicate');
  assert.strictEqual(dedupReport.specialistScores['Sec'], 1.0, 'Should clamp 1.5 score to 1.0');
  console.log('  ✅ PASS: Test 5: Issue deduplication merges duplicates, preserves same-line distinct issues, and clamps scores');

  console.log('\n🎉 All 5 Task 03 Specialist Agents tests passed successfully!\n');
}

runTask03Tests().catch((err) => {
  console.error('❌ Task 03 tests failed:', err);
  process.exit(1);
});
