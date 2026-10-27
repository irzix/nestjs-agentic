import type { SubAgentResult } from './interfaces/orchestration.interface';

/** Confidence similarity does not establish agreement between answers. */
export function evaluateConsensus(
  results: SubAgentResult[],
  evaluator?: (results: SubAgentResult[]) => number,
): number {
  if (!evaluator || results.length < 2 || results.some((r) => r.status !== 'success')) return 0;
  const score = evaluator(results);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new RangeError('consensusEvaluator must return a finite score between 0 and 1.');
  }
  return score;
}
