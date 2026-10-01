import type { RelevanceMatch, RetrievalContext } from '../../interfaces/retrieval.interface';

/**
 * Ids of the retrieved chunks, highest relevance first.
 *
 * Ranks by `context.scores` when present (ties keep their `chunks` order),
 * otherwise by `chunks` order. With `matchOn: 'parentId'` each chunk is
 * replaced by its parent document id and repeats are dropped, so a document
 * ranks where its best chunk ranks and counts once.
 */
export function rankedIds(context: RetrievalContext, matchOn: RelevanceMatch = 'id'): string[] {
  const chunks = context.chunks ?? [];
  const scores = context.scores;
  const ordered =
    scores && scores.size > 0
      ? chunks
          .map((chunk, index) => ({ chunk, index, score: scores.get(chunk.id) ?? Number.NEGATIVE_INFINITY }))
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .map(({ chunk }) => chunk)
      : chunks;

  const ids = ordered.map((chunk) => (matchOn === 'parentId' ? chunk.parentId ?? chunk.id : chunk.id));
  return matchOn === 'parentId' ? [...new Set(ids)] : ids;
}
