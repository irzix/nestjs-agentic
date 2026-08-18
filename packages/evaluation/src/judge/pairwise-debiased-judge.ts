import type {
  PairwiseJudgeCandidate,
  PairwiseJudgeInput,
  PairwiseJudgeResult,
  PairwisePassResult,
} from '../interfaces/evaluation.interface';

/**
 * Functional interface for executing a directional LLM judge evaluation between two candidate responses.
 */
export type PairwiseJudgeFn = (
  query: string,
  firstCandidate: PairwiseJudgeCandidate,
  secondCandidate: PairwiseJudgeCandidate,
  criteria?: string,
  groundTruth?: string,
) => Promise<PairwisePassResult> | PairwisePassResult;

/**
 * Options configuring PairwiseDebiasedJudge evaluation.
 */
export interface PairwiseDebiasedJudgeOptions {
  /** Underlying judge function invoking the LLM */
  judgeFn: PairwiseJudgeFn;
  /** Score difference threshold below which results are considered a tie. Default: `0.05` */
  tieThreshold?: number;
}

/**
 * Pairwise LLM-as-a-Judge evaluator with automated position-swap debiasing.
 *
 * Implements the position debiasing protocol from UC Berkeley LMSYS (MT-Bench, NeurIPS 2023).
 * Evaluates candidate pairs in both forward (A, B) and reverse (B, A) positions to detect and eliminate
 * systematic primacy/recency bias in LLM evaluators.
 *
 * @see Zheng et al., "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena" (NeurIPS 2023, arXiv:2306.05685)
 */
export class PairwiseDebiasedJudge {
  private readonly judgeFn: PairwiseJudgeFn;
  private readonly tieThreshold: number;

  constructor(options: PairwiseDebiasedJudgeOptions) {
    this.judgeFn = options.judgeFn;
    this.tieThreshold = options.tieThreshold ?? 0.05;
  }

  /**
   * Evaluates two candidate agent responses with automated position swapping,
   * averaging scores across forward (A, B) and reverse (B, A) passes to eliminate position bias.
   *
   * @param input Pairwise comparison input (query, candidateA, candidateB, criteria, groundTruth).
   * @returns Debiased evaluation result with individual pass scores and position bias detection.
   */
  async evaluate(input: PairwiseJudgeInput): Promise<PairwiseJudgeResult> {
    const { query, candidateA, candidateB, criteria, groundTruth } = input;

    // 1. Forward Pass: Candidate A presented first, Candidate B second
    const forwardPass = await this.judgeFn(
      query,
      candidateA,
      candidateB,
      criteria,
      groundTruth,
    );

    // 2. Reverse Pass: Candidate B presented first, Candidate A second
    const reversePass = await this.judgeFn(
      query,
      candidateB,
      candidateA,
      criteria,
      groundTruth,
    );

    // Extract individual candidate scores
    const scoreA_forward = Math.min(1.0, Math.max(0.0, forwardPass.scoreFirst));
    const scoreB_forward = Math.min(1.0, Math.max(0.0, forwardPass.scoreSecond));

    const scoreB_reverse = Math.min(1.0, Math.max(0.0, reversePass.scoreFirst));
    const scoreA_reverse = Math.min(1.0, Math.max(0.0, reversePass.scoreSecond));

    // Calculate debiased mean scores
    const debiasedScoreA = Number(((scoreA_forward + scoreA_reverse) / 2).toFixed(4));
    const debiasedScoreB = Number(((scoreB_forward + scoreB_reverse) / 2).toFixed(4));

    // Determine winners in each directional pass
    const forwardWinner =
      forwardPass.winner === 'first'
        ? 'candidate_a'
        : forwardPass.winner === 'second'
        ? 'candidate_b'
        : 'tie';

    const reverseWinner =
      reversePass.winner === 'first'
        ? 'candidate_b'
        : reversePass.winner === 'second'
        ? 'candidate_a'
        : 'tie';

    // Position Bias Detection:
    // Did the judge favor whichever candidate appeared in position 1 in both passes?
    const positionBiasDetected =
      (forwardPass.winner === 'first' && reversePass.winner === 'first') ||
      (forwardPass.winner === 'second' && reversePass.winner === 'second');

    // Confidence Calculation:
    // High confidence if both passes consistently agreed on the same candidate
    let confidence = 0.90;
    if (forwardWinner === reverseWinner && forwardWinner !== 'tie') {
      confidence = 1.0;
    } else if (positionBiasDetected) {
      confidence = 0.60;
    } else if (forwardWinner === 'tie' || reverseWinner === 'tie') {
      confidence = 0.75;
    }

    // Determine final debiased winner
    const scoreDiff = debiasedScoreA - debiasedScoreB;
    let finalWinner: 'candidate_a' | 'candidate_b' | 'tie';

    if (Math.abs(scoreDiff) <= this.tieThreshold) {
      finalWinner = 'tie';
    } else if (scoreDiff > 0) {
      finalWinner = 'candidate_a';
    } else {
      finalWinner = 'candidate_b';
    }

    const reasoning = [
      `Debiased Pairwise Verdict: ${finalWinner.toUpperCase()}`,
      `Candidate A Score: ${debiasedScoreA} (Forward: ${scoreA_forward}, Reverse: ${scoreA_reverse})`,
      `Candidate B Score: ${debiasedScoreB} (Forward: ${scoreB_forward}, Reverse: ${scoreB_reverse})`,
      positionBiasDetected
        ? `⚠️ Position Bias Detected: The evaluator demonstrated primacy preference toward the first presented candidate.`
        : `✓ Position Consistency: Evaluator scores were consistent across swapped positions.`,
      `Forward Reasoning: ${forwardPass.reasoning}`,
      `Reverse Reasoning: ${reversePass.reasoning}`,
    ].join('\n');

    return {
      winner: finalWinner,
      debiasedScoreA,
      debiasedScoreB,
      forwardPass,
      reversePass,
      positionBiasDetected,
      confidence,
      reasoning,
    };
  }
}

/**
 * Convenient standalone helper function for executing a pairwise debiased judge evaluation.
 */
export async function runPairwiseDebiasedJudge(
  input: PairwiseJudgeInput,
  judgeFn: PairwiseJudgeFn,
  options?: Omit<PairwiseDebiasedJudgeOptions, 'judgeFn'>,
): Promise<PairwiseJudgeResult> {
  const judge = new PairwiseDebiasedJudge({ judgeFn, ...options });
  return judge.evaluate(input);
}
