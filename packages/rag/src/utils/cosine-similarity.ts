/**
 * Cosine similarity between two vectors of equal length. Returns `0` for
 * mismatched lengths or zero-magnitude vectors, rather than throwing or
 * producing `NaN`.
 *
 * @param a First vector.
 * @param b Second vector, compared against `a`.
 * @returns Cosine similarity in `[-1, 1]`, or `0` if the inputs are incomparable.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dotProduct / denominator : 0;
}
