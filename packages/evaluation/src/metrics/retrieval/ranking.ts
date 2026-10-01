import type { RankBy, RelevanceMatch, RetrievalContext, RetrievedChunk } from '../../interfaces/retrieval.interface';

/** The id a chunk is matched against ground truth by. */
export function matchIdOf(chunk: RetrievedChunk, matchOn: RelevanceMatch = 'id'): string {
  if (typeof matchOn === 'function') return matchOn(chunk);
  return matchOn === 'parentId' ? chunk.parentId ?? chunk.id : chunk.id;
}

/**
 * The chunks of a context, highest relevance first. With `rankBy: 'scores'`
 * and scores present, sorted by score (ties, and chunks without a finite
 * score, keep their order after scored ones); otherwise in `chunks` order.
 */
export function rankedChunks(context: RetrievalContext, rankBy: RankBy = 'scores'): RetrievedChunk[] {
  const chunks = context.chunks ?? [];
  const scores = context.scores;
  if (rankBy === 'order' || !scores || scores.size === 0) return chunks;
  const scoreOf = (chunk: RetrievedChunk): number => {
    const score = scores.get(chunk.id);
    return typeof score === 'number' && Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY;
  };
  return chunks
    .map((chunk, index) => ({ chunk, index, score: scoreOf(chunk) }))
    .sort((a, b) => (a.score === b.score ? a.index - b.index : b.score > a.score ? 1 : -1))
    .map(({ chunk }) => chunk);
}

/**
 * Matched ids of the retrieved chunks, highest relevance first, each id once
 * at its best rank. Repeats are dropped in every mode, so a chunk returned
 * twice, or a document with several chunks, counts once.
 */
export function rankedIds(
  context: RetrievalContext,
  matchOn: RelevanceMatch = 'id',
  rankBy: RankBy = 'scores',
): string[] {
  return [...new Set(rankedChunks(context, rankBy).map((chunk) => matchIdOf(chunk, matchOn)))];
}
