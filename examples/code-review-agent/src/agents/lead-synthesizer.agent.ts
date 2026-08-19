import { Injectable } from '@nestjs/common';
import { Agent, AgentConfig, AgentProvider } from 'nestjs-agentic';
import type { InlineReviewIssue, ReviewAssessment, SynthesizedPRReviewReport } from './schemas/review-output.schema';

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
   - "APPROVED": Zero critical issues, at most 0-1 isolated high issues, overall score >= 0.70. Medium/low/info suggestions are non-blocking.
   - "CHANGES_REQUESTED": One or more critical severity issues, multiple high severity issues, or overall score < 0.60.
   - "COMMENT": Non-fatal review observations or informational inquiries.
4. Generate a constructive, professional Markdown summary highlighting strengths and separating blocking issues from advisory suggestions.`,
      tools: [],
    };
  }

  /**
   * Deterministically synthesizes raw specialist assessments into a unified report.
   * Deduplicates overlapping findings across Security, Architecture, and Quality reviewers.
   *
   * @param assessments Array of assessments returned by specialist sub-agents.
   * @param consensusScore Agreement score calculated across specialist reviewers.
   * @returns Structured, unified review report.
   */
  synthesize(assessments: ReviewAssessment[], consensusScore = 1.0): SynthesizedPRReviewReport {
    const rawIssues = assessments.flatMap((a) => a.issues || []);
    const deduplicatedIssues = this.deduplicateIssues(rawIssues);
    const specialistScores: Record<string, number> = {};

    let totalScore = 0;
    for (const a of assessments) {
      const score = typeof a.score === 'number' && Number.isFinite(a.score)
        ? Math.max(0.0, Math.min(1.0, a.score))
        : 0.50;
      specialistScores[a.reviewerName] = score;
      totalScore += score;
    }

    const overallScore = assessments.length > 0
      ? Math.round((totalScore / assessments.length) * 1000) / 1000
      : 1.0;

    const criticalIssues = deduplicatedIssues.filter((i) => i.severity === 'critical');
    const highIssues = deduplicatedIssues.filter((i) => i.severity === 'high');

    let overallStatus: SynthesizedPRReviewReport['overallStatus'] = 'APPROVED';
    if (criticalIssues.length > 0 || highIssues.length >= 2 || overallScore < 0.60) {
      overallStatus = 'CHANGES_REQUESTED';
    } else if (highIssues.length === 1 || (deduplicatedIssues.length > 0 && overallScore < 0.75)) {
      overallStatus = 'COMMENT';
    } else {
      overallStatus = 'APPROVED';
    }

    const summaryMarkdown = this.buildSummaryMarkdown(overallStatus, overallScore, assessments, deduplicatedIssues);

    return {
      overallStatus,
      overallScore,
      consensusScore,
      summaryMarkdown,
      specialistScores,
      inlineIssues: deduplicatedIssues,
    };
  }

  /**
   * Deduplicates overlapping issues reporting the same finding on the same line,
   * while preserving distinct issues from different categories or with distinct titles.
   */
  private deduplicateIssues(issues: InlineReviewIssue[]): InlineReviewIssue[] {
    const severityRank: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
      info: 0,
    };

    const map = new Map<string, InlineReviewIssue>();

    for (const issue of issues) {
      const signature = (issue.title || issue.description || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const category = issue.category || 'quality';
      const key = issue.filePath && typeof issue.line === 'number' && issue.line > 0
        ? `${issue.filePath}:${issue.line}:${category}:${signature}`
        : `${issue.filePath}:${category}:${signature}`;

      const existing = map.get(key);
      if (!existing) {
        map.set(key, issue);
      } else {
        const existingRank = severityRank[existing.severity] || 0;
        const currentRank = severityRank[issue.severity] || 0;
        if (currentRank > existingRank) {
          map.set(key, {
            ...issue,
            suggestedFix: issue.suggestedFix || existing.suggestedFix,
            ruleReference: issue.ruleReference || existing.ruleReference,
          });
        } else {
          if (!existing.suggestedFix && issue.suggestedFix) {
            existing.suggestedFix = issue.suggestedFix;
          }
          if (!existing.ruleReference && issue.ruleReference) {
            existing.ruleReference = issue.ruleReference;
          }
        }
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0),
    );
  }

  private buildSummaryMarkdown(
    status: SynthesizedPRReviewReport['overallStatus'],
    score: number,
    assessments: ReviewAssessment[],
    issues: InlineReviewIssue[],
  ): string {
    const statusEmoji = status === 'APPROVED' ? '✅' : status === 'CHANGES_REQUESTED' ? '❌' : '💬';
    const lines: string[] = [
      `### ${statusEmoji} Njent Automated Review Summary: ${status} (Score: ${(score * 100).toFixed(1)}/100)`,
      '',
      '| Reviewer | Category | Score | Status |',
      '|---|---|---|---|',
    ];

    for (const a of assessments) {
      const score = typeof a.score === 'number' && Number.isFinite(a.score)
        ? Math.max(0.0, Math.min(1.0, a.score))
        : 0.50;
      const passText = a.passed ? '✅ Pass' : '⚠️ Attention';
      lines.push(`| **${a.reviewerName}** | \`${a.category}\` | ${(score * 100).toFixed(0)}% | ${passText} |`);
    }

    const blockingIssues = issues.filter((i) => i.severity === 'critical' || i.severity === 'high');
    const advisoryIssues = issues.filter((i) => i.severity === 'medium' || i.severity === 'low' || i.severity === 'info');

    if (blockingIssues.length > 0) {
      lines.push('', '#### 🚨 Blocking Findings (Action Required):');
      for (const issue of blockingIssues) {
        lines.push(`- **[${issue.severity.toUpperCase()}]** \`${issue.filePath}:${issue.line}\` — **${issue.title}**: ${issue.description}`);
        if (issue.suggestedFix) {
          lines.push(`  > *Suggested Fix:* \`${issue.suggestedFix}\``);
        }
      }
    }

    if (advisoryIssues.length > 0) {
      lines.push('', '#### 💡 Advisory & Quality Suggestions (Non-blocking):');
      const topAdvisory = advisoryIssues.slice(0, 3);
      for (const issue of topAdvisory) {
        lines.push(`- **[${issue.severity.toUpperCase()}]** \`${issue.filePath}:${issue.line}\` — **${issue.title}**: ${issue.description}`);
        if (issue.suggestedFix) {
          lines.push(`  > *Suggested Improvement:* \`${issue.suggestedFix}\``);
        }
      }
      if (advisoryIssues.length > 3) {
        lines.push('', `*+ ${advisoryIssues.length - 3} additional advisory suggestion(s) attached inline.*`);
      }
    }

    if (issues.length === 0) {
      lines.push('', '🎉 **No issues identified! Code is fully compliant with architectural, governance, and security standards.**');
    }

    return lines.join('\n');
  }
}
