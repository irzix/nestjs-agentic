/**
 * Validates and maps a reranker API's `{ [resultsKey]: [{ index, relevance_score }] }`
 * response into a scores array parallel to the input chunks. Guards against malformed
 * responses (out-of-range/duplicate indices, non-finite scores) silently misaligning
 * ranking or `minScore` filtering downstream.
 *
 * @param data Parsed JSON response body, treated as untrusted.
 * @param resultsKey Top-level key holding the results array (`'results'` for Cohere, `'data'` for Voyage).
 * @param chunkCount Number of input chunks the scores array must be parallel to.
 * @param providerLabel Human-readable provider name, used in thrown error messages.
 * @returns Array of relevance scores, indexed to match the input chunk order.
 */
export function mapIndexedRerankScores(
  data: unknown,
  resultsKey: string,
  chunkCount: number,
  providerLabel: string,
): number[] {
  const results = (data as Record<string, unknown> | null)?.[resultsKey];
  if (!Array.isArray(results)) {
    throw new Error(`${providerLabel}: response is missing a "${resultsKey}" array`);
  }

  const scores = new Array<number>(chunkCount).fill(0);
  const seenIndices = new Set<number>();

  for (const r of results) {
    const index = (r as { index?: unknown })?.index;
    const score = (r as { relevance_score?: unknown })?.relevance_score;

    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= chunkCount) {
      throw new Error(`${providerLabel}: response contains an out-of-range index (${index})`);
    }
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      throw new Error(`${providerLabel}: response contains a non-finite relevance score for index ${index}`);
    }
    if (seenIndices.has(index as number)) {
      throw new Error(`${providerLabel}: response contains a duplicate index (${index})`);
    }
    seenIndices.add(index as number);

    scores[index as number] = score;
  }

  return scores;
}
