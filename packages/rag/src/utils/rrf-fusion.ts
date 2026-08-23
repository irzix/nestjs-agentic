/**
 * Fuses multiple already-ranked id lists via Reciprocal Rank Fusion (RRF):
 *
 * `score(id) = sum over each list m containing id: weight_m / (k + rank_m(id))`
 *
 * Rank-based, so it needs no normalization across incomparable score scales
 * (e.g. cosine similarity vs. BM25) — a list not containing an id just
 * contributes nothing for it.
 *
 * @param rankedLists Arrays of item ids, each already sorted best-first (rank 1 = index 0).
 * @param options.k Smoothing constant. Default: `60` (standard RRF paper default).
 * @param options.weights Per-list weight, parallel to `rankedLists`. Default: `1` for every list.
 * @returns Map of item id to fused RRF score, unsorted.
 */
export function reciprocalRankFusion(
  rankedLists: string[][],
  options?: { k?: number; weights?: number[] },
): Map<string, number> {
  const k = options?.k ?? 60;
  const weights = options?.weights;

  const scores = new Map<string, number>();
  for (let listIndex = 0; listIndex < rankedLists.length; listIndex++) {
    const weight = weights?.[listIndex] ?? 1;
    const list = rankedLists[listIndex];
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      const contribution = weight / (k + i + 1);
      scores.set(id, (scores.get(id) ?? 0) + contribution);
    }
  }
  return scores;
}
