import { Injectable, Optional } from '@nestjs/common';
import type { ReviewAssessment } from '../agents/schemas/review-output.schema';

/**
 * Result of consensus calculation across specialist reviewer assessments.
 */
export interface ConsensusResult {
  consensusScore: number; // 0.0 to 1.0 (1.0 = unanimous agreement)
  variance: number;
  meanScore: number;
  isHighAgreement: boolean;
  divergentReviewers: string[];
}

/**
 * Calculates mathematical consensus and variance across multi-agent review findings.
 * Identifies high-divergence reviews requiring maintainer cross-examination.
 */
@Injectable()
export class ConsensusEvaluatorService {
  private readonly highAgreementThreshold: number;

  constructor(@Optional() options?: { highAgreementThreshold?: number }) {
    this.highAgreementThreshold = options?.highAgreementThreshold ?? 0.80;
  }

  /**
   * Calculates consensus metrics across an array of specialist assessments.
   *
   * @param assessments Array of assessments from Security, Architecture, Quality agents.
   * @returns ConsensusResult with convergence score and divergence metrics.
   */
  evaluateConsensus(assessments: ReviewAssessment[]): ConsensusResult {
    if (!assessments || assessments.length <= 1) {
      return {
        consensusScore: 1.0,
        variance: 0.0,
        meanScore: assessments?.[0]?.score ?? 1.0,
        isHighAgreement: true,
        divergentReviewers: [],
      };
    }

    const scores = assessments.map((a) => a.score);
    const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;

    // Population variance: Sum((x - mean)^2) / N
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;

    // Maximum theoretical variance on [0, 1] bounded scores is 0.25 (e.g. half 0, half 1)
    const MAX_VARIANCE = 0.25;
    const normalizedVariance = Math.min(1.0, variance / MAX_VARIANCE);
    const consensusScore = Math.round(Math.max(0.0, 1.0 - normalizedVariance) * 1000) / 1000;

    // Identify reviewers with scores deviating > 0.25 from the mean
    const divergentReviewers = assessments
      .filter((a) => Math.abs(a.score - mean) > 0.25)
      .map((a) => a.reviewerName);

    return {
      consensusScore,
      variance: Math.round(variance * 10000) / 10000,
      meanScore: Math.round(mean * 1000) / 1000,
      isHighAgreement: consensusScore >= this.highAgreementThreshold,
      divergentReviewers,
    };
  }
}
