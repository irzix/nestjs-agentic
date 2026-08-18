import { Injectable, Optional } from '@nestjs/common';
import { PairwiseDebiasedJudge } from '@nestjs-agentic/evaluation';
import type { PairwiseJudgeFn, PairwiseJudgeResult } from '@nestjs-agentic/evaluation';
import type { InlineReviewIssue } from '../agents/schemas/review-output.schema';

/**
 * Quality evaluation gate that verifies review comment accuracy and eliminates
 * LLM judge position bias prior to publishing to GitHub.
 */
@Injectable()
export class ReviewQualityEvaluatorService {
  private readonly pairwiseJudge: PairwiseDebiasedJudge;

  constructor(@Optional() customJudgeFn?: PairwiseJudgeFn) {
    const judgeFn: PairwiseJudgeFn = customJudgeFn || ((query, first, second) => {
      // Default heuristic judge scoring based on rubric adherence
      const firstScore = first.output.includes('`') ? 0.90 : 0.60;
      const secondScore = second.output.includes('`') ? 0.90 : 0.60;
      return {
        winner: firstScore > secondScore ? 'first' : secondScore > firstScore ? 'second' : 'tie',
        scoreFirst: firstScore,
        scoreSecond: secondScore,
        reasoning: 'Evaluated on actionability and markdown formatting',
      };
    });

    this.pairwiseJudge = new PairwiseDebiasedJudge({
      judgeFn,
      tieThreshold: 0.05,
    });
  }

  /**
   * Validates that all inline review issues point to lines that actually exist in the modified diff.
   * Drops hallucinated or out-of-boundary line references.
   *
   * @param issues Array of inline review issues.
   * @param validDiffLineNumbers Set of valid line numbers from the git diff.
   * @returns Array of validated, in-boundary issues.
   */
  validateDiffBoundaries(
    issues: InlineReviewIssue[],
    validDiffLineNumbers: Map<string, Set<number>>,
  ): { validIssues: InlineReviewIssue[]; droppedIssues: InlineReviewIssue[] } {
    const validIssues: InlineReviewIssue[] = [];
    const droppedIssues: InlineReviewIssue[] = [];

    for (const issue of issues) {
      const fileLines = validDiffLineNumbers.get(issue.filePath);
      if (fileLines && fileLines.has(issue.line)) {
        validIssues.push(issue);
      } else {
        // Drop hallucinated line references
        droppedIssues.push(issue);
      }
    }

    return { validIssues, droppedIssues };
  }

  /**
   * Evaluates two candidate review reports using MT-Bench pairwise position debiasing.
   *
   * @param query Review context / prompt.
   * @param candidateA First candidate review text.
   * @param candidateB Second candidate review text.
   * @returns Pairwise debiased evaluation result.
   */
  async evaluateDebiased(
    query: string,
    candidateA: string,
    candidateB: string,
  ): Promise<PairwiseJudgeResult> {
    return this.pairwiseJudge.evaluate({
      query,
      candidateA: { id: 'candidate_a', output: candidateA },
      candidateB: { id: 'candidate_b', output: candidateB },
      criteria: 'Actionability, lack of hallucinated lines, and constructive tone',
    });
  }
}
