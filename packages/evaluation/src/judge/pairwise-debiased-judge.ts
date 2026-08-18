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

function normalizeScore(score: number): number {
  if (!Number.isFinite(score)) {
    throw new RangeError('Pairwise judge scores must be finite numbers');
  }
  return Math.min(1.0, Math.max(0.0, score));
}

function validateTieThreshold(tieThreshold: number): number {
  if (!Number.isFinite(tieThreshold) || tieThreshold < 0 || tieThreshold > 1) {
    throw new RangeError('tieThreshold must be a finite number between 0 and 1');
  }
  return tieThreshold;
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
    this.tieThreshold = validateTieThreshold(options.tieThreshold ?? 0.05);
  }

  /**
   * O(1) time and memory; evaluates both presentation orders concurrently.
   *
   * @param input Pairwise comparison input (query, candidateA, candidateB, criteria, groundTruth).
   * @returns Debiased evaluation result with individual pass scores and position bias detection.
   */
  async evaluate(input: PairwiseJudgeInput): Promise<PairwiseJudgeResult> {
    const { query, candidateA, candidateB, criteria, groundTruth } = input;

    // 1. Forward Pass: Candidate A presented first, Candidate B second
    const [forwardPass, reversePass] = await Promise.all([
      this.judgeFn(query, candidateA, candidateB, criteria, groundTruth),
      this.judgeFn(query, candidateB, candidateA, criteria, groundTruth),
    ]);

    // Extract individual candidate scores
    const scoreA_forward = normalizeScore(forwardPass.scoreFirst);
    const scoreB_forward = normalizeScore(forwardPass.scoreSecond);

    const scoreB_reverse = normalizeScore(reversePass.scoreFirst);
    const scoreA_reverse = normalizeScore(reversePass.scoreSecond);

    // Calculate debiased mean scores
    const debiasedScoreA = Math.round(((scoreA_forward + scoreA_reverse) / 2) * 10000) / 10000;
    const debiasedScoreB = Math.round(((scoreB_forward + scoreB_reverse) / 2) * 10000) / 10000;

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
