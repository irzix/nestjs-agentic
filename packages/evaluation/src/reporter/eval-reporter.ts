import type { BenchmarkSummary } from '../interfaces/evaluation.interface';

/**
 * Service for generating benchmark reports in formatted GitHub-Flavored Markdown.
 */
export class EvalReporter {
  /**
   * Formats a benchmark summary object into a formatted GitHub-Flavored Markdown report string.
   *
   * @param summary BenchmarkSummary object returned by BenchmarkRunner.
   * @returns Markdown report string.
   */
  static generateMarkdownReport(summary: BenchmarkSummary): string {
    const lines: string[] = [];

    lines.push('# 📊 Agent Evaluation Benchmark Report');
    lines.push('');
    lines.push(`- **Total Items**: ${summary.totalItems}`);
    lines.push(`- **Passed**: ${summary.passedItems} ✅`);
    lines.push(`- **Failed**: ${summary.failedItems} ❌`);
    lines.push(`- **Pass Rate**: ${(summary.passRate * 100).toFixed(1)}%`);
    lines.push(`- **Average Score**: ${(summary.averageScore * 100).toFixed(1)}%`);
    lines.push(`- **Statistical Overall Variance**: ${summary.overallVariance.toFixed(4)}`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('### Item Execution Details');
    lines.push('');

    for (const res of summary.itemResults) {
      const statusIcon = res.overallPassed ? '✅ PASS' : '❌ FAIL';
      lines.push(`#### [${statusIcon}] Item ${res.item.id}: "${res.item.query}"`);
      lines.push(`- **Overall Score**: ${(res.score * 100).toFixed(1)}%`);
      if (res.multiTrialSummary) {
        lines.push(`- **Multi-Trial StdDev ($\sigma$)**: ${res.multiTrialSummary.standardDeviation.toFixed(4)}`);
      }
      lines.push(`- **Agent Output**: ${res.agentResult.output || '*(No output)*'}`);
      lines.push('- **Metric Evaluations**:');

      for (const m of res.metrics) {
        const mIcon = m.passed ? '✅' : '❌';
        lines.push(`  - ${mIcon} **${m.metricName}** (${(m.score * 100).toFixed(0)}%): ${m.reason || ''}`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }
}
