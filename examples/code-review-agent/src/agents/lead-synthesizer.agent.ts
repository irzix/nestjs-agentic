import { Injectable } from '@nestjs/common';
import { Agent, AgentConfig, AgentProvider } from 'nestjs-agentic';
import type { ReviewAssessment, SynthesizedPRReviewReport } from './schemas/review-output.schema';

/**
 * Supervisor agent synthesizing multi-agent specialist reviews into a unified, actionable PR report.
 */
@Injectable()
@Agent({
  name: 'lead-synthesizer',
  description: 'Synthesizes specialized security, architecture, and quality reviews into an authoritative pull request decision report.',
})
export class LeadSynthesizerAgent implements AgentProvider {
  define(): AgentConfig {
    return {
      instructions: `You are the Lead Synthesizer Agent for Njent.
Your role is to evaluate and synthesize the domain findings from specialized sub-agents:
1. Deduplicate overlapping issues between Security, Architecture, and Quality reviewers.
2. Group inline issues by file and line number, sorted by severity (critical > high > medium > low).
3. Compute an overall pull request decision:
   - "APPROVED": Zero critical or high severity issues, overall score >= 0.85.
   - "CHANGES_REQUESTED": One or more critical/high severity issues or overall score < 0.70.
   - "COMMENT": Informational suggestions only without fatal blockers.
4. Generate a constructive, professional Markdown summary highlighting strengths and specific steps required to resolve findings.`,
      tools: [],
    };
  }

  /**
   * Deterministically synthesizes raw specialist assessments into a unified report.
   *
   * @param assessments Array of assessments returned by specialist sub-agents.
   * @param consensusScore Agreement score calculated across specialist reviewers.
   * @returns Structured, unified review report.
   */
  synthesize(assessments: ReviewAssessment[], consensusScore = 1.0): SynthesizedPRReviewReport {
    const allIssues = assessments.flatMap((a) => a.issues);
    const specialistScores: Record<string, number> = {};

    let totalScore = 0;
    for (const a of assessments) {
      specialistScores[a.reviewerName] = a.score;
      totalScore += a.score;
    }

    const overallScore = assessments.length > 0
      ? Math.round((totalScore / assessments.length) * 1000) / 1000
      : 1.0;

    const hasCritical = allIssues.some((i) => i.severity === 'critical');
    const hasHigh = allIssues.some((i) => i.severity === 'high');

    let overallStatus: SynthesizedPRReviewReport['overallStatus'] = 'APPROVED';
    if (hasCritical || hasHigh || overallScore < 0.70) {
      overallStatus = 'CHANGES_REQUESTED';
    } else if (allIssues.length > 0) {
      overallStatus = 'COMMENT';
    }

    const summaryMarkdown = this.buildSummaryMarkdown(overallStatus, overallScore, assessments, allIssues);

    return {
      overallStatus,
      overallScore,
      consensusScore,
      summaryMarkdown,
      specialistScores,
      inlineIssues: allIssues,
    };
  }

  private buildSummaryMarkdown(
    status: SynthesizedPRReviewReport['overallStatus'],
    score: number,
    assessments: ReviewAssessment[],
    issues: ReviewAssessment['issues'],
  ): string {
    const statusEmoji = status === 'APPROVED' ? '✅' : status === 'CHANGES_REQUESTED' ? '❌' : '💬';
    const lines: string[] = [
      `### ${statusEmoji} Njent Automated Review Summary: ${status} (Score: ${(score * 100).toFixed(1)}/100)`,
      '',
      '| Reviewer | Category | Score | Status |',
      '|---|---|---|---|',
    ];

    for (const a of assessments) {
      const passText = a.passed ? '✅ Pass' : '⚠️ Attention';
      lines.push(`| **${a.reviewerName}** | \`${a.category}\` | ${(a.score * 100).toFixed(0)}% | ${passText} |`);
    }

    if (issues.length > 0) {
      lines.push('', '#### 🔍 Key Findings:');
      for (const issue of issues) {
        lines.push(`- **[${issue.severity.toUpperCase()}]** \`${issue.filePath}:${issue.line}\` — **${issue.title}**: ${issue.description}`);
        if (issue.suggestedFix) {
          lines.push(`  > *Suggested Fix:* \`${issue.suggestedFix}\``);
        }
      }
    } else {
      lines.push('', '🎉 **No issues identified! Code is compliant with architectural and security standards.**');
    }

    return lines.join('\n');
  }
}
