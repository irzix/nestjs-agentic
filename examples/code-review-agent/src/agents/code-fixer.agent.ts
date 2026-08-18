import { Injectable } from '@nestjs/common';
import { Agent, AgentConfig, AgentProvider } from 'nestjs-agentic';
import type { InlineReviewIssue } from './schemas/review-output.schema';

/**
 * Autonomous repair agent that takes identified review issues and generates
 * minimal, syntactically valid unified git diff patches.
 */
@Injectable()
@Agent({
  name: 'code-fixer',
  description: 'Generates automated code patch diffs and branch modifications for pull request review findings.',
})
export class CodeFixerAgent implements AgentProvider {
  define(): AgentConfig {
    return {
      instructions: `You are the Code Fixer Agent for Njent.
When provided with code review issues:
1. Generate precise, minimal TypeScript code patches addressing each issue without modifying unrelated logic.
2. Ensure that generated code follows strict TypeScript typing (no "any").
3. Format output as valid Unified Diff patches (diff --git a/... b/...).
4. All code modifications will be verified in the Docker MCP sandbox before requesting maintainer approval.`,
      tools: [],
    };
  }

  /**
   * Generates mock/deterministic patch strings from review issues for automated test verification.
   *
   * @param issues Array of issues to fix.
   * @returns Array of unified diff strings.
   */
  generateFixPatches(issues: InlineReviewIssue[]): string[] {
    const patches: string[] = [];

    for (const issue of issues) {
      if (issue.suggestedFix) {
        patches.push(
          [
            `diff --git a/${issue.filePath} b/${issue.filePath}`,
            `--- a/${issue.filePath}`,
            `+++ b/${issue.filePath}`,
            `@@ -${issue.line},1 +${issue.line},1 @@`,
            `+${issue.suggestedFix}`,
          ].join('\n'),
        );
      }
    }

    return patches;
  }
}
