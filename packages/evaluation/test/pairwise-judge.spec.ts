import {
  PairwiseDebiasedJudge,
  runPairwiseDebiasedJudge,
  type PairwiseJudgeCandidate,
  type PairwiseJudgeInput,
  type PairwisePassResult,
} from '../src';

export async function runPairwiseJudgeTests() {
  console.log('⚖️ Running PairwiseDebiasedJudge Tests (MT-Bench Position Debiasing)...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // 1. Consistent Evaluator without Position Bias (Candidate A is genuinely superior)
  try {
    const candidateA: PairwiseJudgeCandidate = {
      id: 'agent_v2_frugal',
      output: 'Detailed and accurate explanation with step-by-step mathematical proof.',
    };
    const candidateB: PairwiseJudgeCandidate = {
      id: 'agent_v1_legacy',
      output: 'Short vague answer.',
    };

    const fairJudge = new PairwiseDebiasedJudge({
      judgeFn: async (_q, first, second): Promise<PairwisePassResult> => {
        // Fair judge: agent_v2_frugal always gets 0.95, legacy gets 0.40 regardless of position
        if (first.id === 'agent_v2_frugal') {
          return {
            winner: 'first',
            scoreFirst: 0.95,
            scoreSecond: 0.40,
            reasoning: 'Candidate A is rigorous and mathematically sound.',
          };
        } else {
          return {
            winner: 'second',
            scoreFirst: 0.40,
            scoreSecond: 0.95,
            reasoning: 'Candidate A (second) is rigorous and mathematically sound.',
          };
        }
      },
    });

    const result = await fairJudge.evaluate({
      query: 'Explain gradient descent',
      candidateA,
      candidateB,
    });

    assert(result.winner === 'candidate_a', 'Test 1a: Genuinely superior candidate A wins');
    assert(result.debiasedScoreA === 0.95, 'Test 1b: Debiased score for candidate A is 0.95');
    assert(result.debiasedScoreB === 0.40, 'Test 1c: Debiased score for candidate B is 0.40');
    assert(result.positionBiasDetected === false, 'Test 1d: No position bias detected for consistent judge');
    assert(result.confidence === 1.0, 'Test 1e: Full confidence (1.0) on unanimous agreement');
  } catch (err: unknown) {
    assert(false, 'Test 1: Consistent Evaluator', String(err));
  }

  // 2. Position Bias Detection & Debiasing (Judge exhibits heavy Primacy Bias)
  try {
    const candidateA: PairwiseJudgeCandidate = {
      id: 'model_alpha',
      output: 'Balanced answer A.',
    };
    const candidateB: PairwiseJudgeCandidate = {
      id: 'model_beta',
      output: 'Balanced answer B.',
    };

    // Heavily biased judge: ALWAYS gives 0.90 to the first presented candidate and 0.50 to the second!
    const biasedJudge = new PairwiseDebiasedJudge({
      judgeFn: async (_q, first, _second): Promise<PairwisePassResult> => {
        return {
          winner: 'first',
          scoreFirst: 0.90,
          scoreSecond: 0.50,
          reasoning: `Preferred ${first.id} simply because it was presented first.`,
        };
      },
      tieThreshold: 0.05,
    });

    const result = await biasedJudge.evaluate({
      query: 'Summarize project goals',
      candidateA,
      candidateB,
    });

    assert(result.positionBiasDetected === true, 'Test 2a: Position bias successfully detected');
    assert(result.debiasedScoreA === 0.70, 'Test 2b: Candidate A score debiased to (0.90+0.50)/2 = 0.70');
    assert(result.debiasedScoreB === 0.70, 'Test 2c: Candidate B score debiased to (0.50+0.90)/2 = 0.70');
    assert(result.winner === 'tie', 'Test 2d: Symmetric debiasing resolves position bias into fair TIE');
    assert(result.confidence === 0.60, 'Test 2e: Evaluator confidence degraded due to detected bias');
  } catch (err: unknown) {
    assert(false, 'Test 2: Position Bias Detection', String(err));
  }

  // 3. Candidate B Wins (Reverse order dominance)
  try {
    const candidateA: PairwiseJudgeCandidate = { id: 'a', output: 'Brief' };
    const candidateB: PairwiseJudgeCandidate = { id: 'b', output: 'Comprehensive' };

    const judge = new PairwiseDebiasedJudge({
      judgeFn: async (_q, first, second) => {
        if (first.id === 'b') {
          return { winner: 'first', scoreFirst: 0.88, scoreSecond: 0.52, reasoning: 'B is better' };
        } else {
          return { winner: 'second', scoreFirst: 0.52, scoreSecond: 0.88, reasoning: 'B is better' };
        }
      },
    });

    const result = await judge.evaluate({ query: 'Test', candidateA, candidateB });
    assert(result.winner === 'candidate_b', 'Test 3a: Candidate B wins debiased evaluation');
    assert(result.debiasedScoreB === 0.88, 'Test 3b: Candidate B debiased score is 0.88');
    assert(result.debiasedScoreA === 0.52, 'Test 3c: Candidate A debiased score is 0.52');
  } catch (err: unknown) {
    assert(false, 'Test 3: Candidate B dominance', String(err));
  }

  // 4. Clamping and Standalone runPairwiseDebiasedJudge Helper
  try {
    const input: PairwiseJudgeInput = {
      query: 'Code review task',
      candidateA: { id: 'c1', output: 'code 1' },
      candidateB: { id: 'c2', output: 'code 2' },
      criteria: 'Check for security flaws',
    };

    const standaloneResult = await runPairwiseDebiasedJudge(input, async (_q, first) => {
      const isC1First = first.id === 'c1';
      return {
        winner: isC1First ? 'first' : 'second',
        scoreFirst: isC1First ? 1.5 : -0.2, // c1 gets 1.5 (> 1.0), c2 gets -0.2 (< 0.0)
        scoreSecond: isC1First ? -0.2 : 1.5,
        reasoning: 'Out of bounds scores normalized safely',
      };
    });

    assert(standaloneResult.debiasedScoreA === 1.0, 'Test 4a: Score clamped to 1.0 max');
    assert(standaloneResult.debiasedScoreB === 0.0, 'Test 4b: Score clamped to 0.0 min');
    assert(standaloneResult.winner === 'candidate_a', 'Test 4c: Candidate A declared winner');
  } catch (err: unknown) {
    assert(false, 'Test 4: Clamping and Helper', String(err));
  }

  if (failed > 0) {
    throw new Error(`${failed} PairwiseDebiasedJudge test(s) failed.`);
  }

  console.log(`\n🎉 All ${passed} PairwiseDebiasedJudge tests passed successfully.\n`);
}

if (require.main === module) {
  runPairwiseJudgeTests().catch(() => process.exit(1));
}
