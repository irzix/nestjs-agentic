/**
 * Severity level of an identified review issue.
 */
export type ReviewSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Domain category of a specialized review.
 */
export type ReviewCategory = 'security' | 'architecture' | 'quality' | 'performance';

/**
 * Granular inline review comment item pointing to a specific line in a modified file.
 */
export interface InlineReviewIssue {
  filePath: string;
  line: number;
  category: ReviewCategory;
  severity: ReviewSeverity;
  title: string;
  description: string;
  suggestedFix?: string;
  ruleReference?: string;
}

/**
 * Consolidated review assessment emitted by specialist reviewers and synthesized by the lead agent.
 */
export interface ReviewAssessment {
  reviewerName: string;
  category: ReviewCategory;
  score: number; // 0.0 to 1.0
  passed: boolean;
  summary: string;
  issues: InlineReviewIssue[];
  strengths: string[];
}

/**
 * Final synthesized PR review report published back to GitHub.
 */
export interface SynthesizedPRReviewReport {
  overallStatus: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENT';
  overallScore: number;
  consensusScore: number;
  summaryMarkdown: string;
  specialistScores: Record<string, number>;
  inlineIssues: InlineReviewIssue[];
  suggestedDiffPatches?: string[];
  evaluationQualityScore?: number;
}
