import type { DocumentChunk } from '../interfaces/document.interface';
import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';
import { cosineSimilarity } from '../utils/cosine-similarity';

/**
 * Options for configuring MmrStrategy.
 */
export interface MmrStrategyOptions {
  /** Maximum number of chunks to select. Default: `5` */
  topK?: number;

  /**
   * Balances relevance to the query against diversity from already-selected
   * chunks: `1` is pure relevance (no diversity), `0` is pure diversity
   * (ignores relevance after the first pick). Default: `0.5`
   */
  lambda?: number;
}

/**
 * Post-retrieval RAG Strategy implementing Maximal Marginal Relevance (MMR):
 * greedily selects chunks that are relevant to the query but dissimilar to
 * chunks already selected, reducing near-duplicate context (e.g. overlapping
 * parent/child chunks or repeated sections) crowding out distinct information.
 *
 * `MMR = argmax_{d in R \ S} [ lambda * Sim(d, q) - (1 - lambda) * max_{d' in S} Sim(d, d') ]`
 *
 * `Sim(d, q)` uses `context.scores` (the retrieval relevance score already
 * populated by `RAGPipeline`). `Sim(d, d')` requires chunk embeddings — a
 * chunk without an `embedding` is treated as having zero similarity to every
 * other chunk, so it can still be selected but never penalizes or is
 * penalized by diversity against the ones that do carry embeddings.
 */
export class MmrStrategy implements RAGStrategy {
  readonly name = 'MMR';
  readonly phase = 'post-retrieval' as const;
  private readonly topK: number;
  private readonly lambda: number;

  /**
   * Creates a new instance of MmrStrategy.
   * @param options Configuration for top-K cutoff and the relevance/diversity balance (`lambda`).
   */
  constructor(options?: MmrStrategyOptions) {
    this.topK = options?.topK ?? 5;
    this.lambda = options?.lambda ?? 0.5;
  }

  /**
   * Selects a diverse top-K subset of `context.chunks` via MMR.
   *
   * @param context RAGContext payload containing retrieved chunks and their relevance `scores`.
   * @returns Updated RAGContext with `chunks` replaced by the MMR-selected subset.
   */
  process(context: RAGContext): RAGContext {
    const chunks = context.chunks ?? [];
    if (chunks.length === 0) return context;

    // Without any chunk embeddings there's no diversity signal to select by;
    // pass through the incoming order (already relevance-ranked upstream).
    if (!chunks.some((c) => c.embedding)) {
      return { ...context, chunks: chunks.slice(0, this.topK) };
    }

    const scores = context.scores;
    const relevance = (chunk: DocumentChunk): number => scores?.get(chunk.id) ?? 0;

    const remaining = [...chunks];
    const selected: DocumentChunk[] = [];

    while (remaining.length > 0 && selected.length < this.topK) {
      let bestIndex = 0;
      let bestScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        const relevanceScore = relevance(candidate);

        // Chunks without an embedding can't be compared for similarity, so
        // they never get diversity-penalized (or credited) against selected chunks.
        let maxSimToSelected = 0;
        if (candidate.embedding) {
          for (const s of selected) {
            if (!s.embedding) continue;
            const sim = cosineSimilarity(candidate.embedding, s.embedding);
            if (sim > maxSimToSelected) maxSimToSelected = sim;
          }
        }

        const mmrScore = this.lambda * relevanceScore - (1 - this.lambda) * maxSimToSelected;
        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestIndex = i;
        }
      }

      selected.push(remaining[bestIndex]);
      remaining.splice(bestIndex, 1);
    }

    return { ...context, chunks: selected };
  }
}
