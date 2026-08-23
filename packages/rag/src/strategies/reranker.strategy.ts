import type { DocumentChunk } from '../interfaces/document.interface';
import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';

/**
 * Type alias for a custom re-ranking function (e.g. Cohere Rerank, BGE-Reranker, Cross-Encoder).
 * Should return an array of relevance scores parallel to the input chunks array.
 */
export type RerankFunction = (query: string, chunks: DocumentChunk[]) => Promise<number[]> | number[];

/**
 * Options for configuring RerankerStrategy.
 */
export interface RerankerStrategyOptions {
  /** Maximum top-K candidate chunks to return post re-ranking. Default: `5` */
  topK?: number;

  /** Custom Cross-Encoder or neural re-ranking model function (e.g. Cohere Rerank, BGE-Reranker). */
  rerankFn?: RerankFunction;

  /** Chunks scoring below this relevance threshold are dropped entirely, post-rerank. Default: none (no filtering) */
  minScore?: number;

  /**
   * What to do when `rerankFn` throws. `'fallback'` degrades to internal
   * term-overlap scoring (previous default behavior). `'throw'` propagates
   * the error instead of silently degrading quality. Either way, the failure
   * is reported to `onRerankFailure` first. Default: `'fallback'`
   */
  onRerankFailureMode?: 'fallback' | 'throw';

  /** Called whenever `rerankFn` throws, so failures are observable instead of silently swallowed. */
  onRerankFailure?: (error: unknown) => void;
}

/**
 * Post-retrieval RAG Strategy that recalculates relevance scores for candidate chunks using Cross-Encoder
 * models or term-frequency scoring, then re-orders results to surface the top matches first.
 */
export class RerankerStrategy implements RAGStrategy {
  readonly name = 'Reranker';
  readonly phase = 'post-retrieval' as const;
  private readonly topK: number;
  private readonly rerankFn?: RerankFunction;
  private readonly minScore?: number;
  private readonly onRerankFailureMode: 'fallback' | 'throw';
  private readonly onRerankFailure?: (error: unknown) => void;

  /**
   * Creates a new instance of RerankerStrategy.
   * @param options Configuration for top-K cutoff and optional cross-encoder rerank function.
   */
  constructor(options?: RerankerStrategyOptions) {
    this.topK = options?.topK ?? 5;
    this.rerankFn = options?.rerankFn;
    this.minScore = options?.minScore;
    this.onRerankFailureMode = options?.onRerankFailureMode ?? 'fallback';
    this.onRerankFailure = options?.onRerankFailure;
  }

  /**
   * Scores and re-orders retrieved chunks by relevance, optionally using a Cross-Encoder model.
   * Falls back to internal TF-based scoring if no `rerankFn` is provided or if it throws an error.
   *
   * @param context RAGContext payload containing retrieved chunks and the original query.
   * @returns Promise resolving to updated RAGContext with `chunks` re-ordered by relevance score.
   */
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
      } catch (err) {
        this.onRerankFailure?.(err);
        if (this.onRerankFailureMode === 'throw') {
          throw err;
        }
        // Fallback to internal scoring below.
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

    if (this.minScore !== undefined) {
      scoredChunks = scoredChunks.filter((s) => s.relevanceScore >= this.minScore!);
    }

    const rerankedChunks = scoredChunks.slice(0, this.topK).map((s) => s.chunk);

    return {
      ...context,
      chunks: rerankedChunks,
      scores: scoresMap,
    };
  }
}
