import type { DocumentChunk } from '../interfaces/document.interface';
import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';

export type RerankFunction = (query: string, chunks: DocumentChunk[]) => Promise<number[]> | number[];

export interface RerankerStrategyOptions {
  /** Maximum top-K candidate chunks to return post re-ranking. Default: 5 */
  topK?: number;
  /** Custom Cross-Encoder or neural re-ranking model function (e.g. Cohere Rerank, BGE-Reranker). */
  rerankFn?: RerankFunction;
}

/**
 * Re-ranking Strategy: Recalculates relevance scores for candidate chunks using Cross-Encoder models
 * or term-frequency relevance, re-ordering results to put top matches first.
 */
export class RerankerStrategy implements RAGStrategy {
  readonly name = 'Reranker';
  private readonly topK: number;
  private readonly rerankFn?: RerankFunction;

  constructor(options?: RerankerStrategyOptions) {
    this.topK = options?.topK ?? 5;
    this.rerankFn = options?.rerankFn;
  }

  async process(context: RAGContext): Promise<RAGContext> {
    if (!context.chunks || context.chunks.length === 0) {
      return context;
    }

    const scoresMap = new Map<string, number>(context.scores);
    let scoredChunks: Array<{ chunk: DocumentChunk; relevanceScore: number }> = [];

    // 1. Custom Cross-Encoder Reranker function if supplied
    if (this.rerankFn) {
      try {
        const customScores = await this.rerankFn(context.query, context.chunks);
        scoredChunks = context.chunks.map((chunk, index) => {
          const score = customScores[index] ?? (scoresMap.get(chunk.id) || 0);
          scoresMap.set(chunk.id, score);
          return { chunk, relevanceScore: score };
        });
      } catch {
        // Fallback to internal scoring if rerankFn throws an error
      }
    }

    // 2. Default term relevance + Graph boost scoring if rerankFn wasn't used or failed
    if (scoredChunks.length === 0) {
      const queryTokens = new Set(
        context.query.toLowerCase().split(/\s+/).filter((t) => t.length > 2),
      );

      scoredChunks = context.chunks.map((chunk) => {
        const tokens = chunk.content.toLowerCase().split(/\s+/);
        let matchCount = 0;
        for (const t of tokens) {
          if (queryTokens.has(t)) matchCount++;
        }
        const termScore = matchCount / Math.max(tokens.length, 1);
        const existingBoost = scoresMap.get(chunk.id) ?? 1.0;
        const finalScore = termScore * existingBoost;

        scoresMap.set(chunk.id, finalScore);
        return { chunk, relevanceScore: finalScore };
      });
    }

    scoredChunks.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const rerankedChunks = scoredChunks.slice(0, this.topK).map((s) => s.chunk);

    return {
      ...context,
      chunks: rerankedChunks,
      scores: scoresMap,
    };
  }
}
