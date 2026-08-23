import type { DocumentChunk } from '../interfaces/document.interface';
import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';
import type { KnowledgeBase } from './knowledge-base';

/**
 * Options for configuring RAGPipeline.
 */
export interface RAGPipelineOptions {
  /** Target KnowledgeBase engine instance used to retrieve document chunks. */
  knowledgeBase: KnowledgeBase;

  /** Ordered array of RAG strategies to execute in the pipeline. */
  strategies?: RAGStrategy[];
}

/**
 * RAGPipeline engine orchestrating chained execution of pre-retrieval and post-retrieval RAG strategies.
 */
export class RAGPipeline {
  private readonly knowledgeBase: KnowledgeBase;
  private readonly preRetrievalStrategies: RAGStrategy[] = [];
  private readonly postRetrievalStrategies: RAGStrategy[] = [];

  /**
   * Creates a new instance of RAGPipeline.
   * @param options Configuration options containing target KnowledgeBase and strategy array.
   */
  constructor(options: RAGPipelineOptions) {
    this.knowledgeBase = options.knowledgeBase;

    if (options.strategies) {
      for (const strat of options.strategies) {
        this.addStrategy(strat);
      }
    }
  }

  /**
   * Registers a new RAGStrategy into the appropriate pipeline stage (pre-retrieval vs post-retrieval).
   *
   * @param strategy The RAGStrategy instance to register.
   */
  addStrategy(strategy: RAGStrategy): void {
    if (strategy.phase === 'pre-retrieval') {
      this.preRetrievalStrategies.push(strategy);
    } else {
      this.postRetrievalStrategies.push(strategy);
    }
  }

  /**
   * Executes the full RAG pipeline across pre-retrieval expansion, knowledge base retrieval, and post-retrieval compression/reranking.
   *
   * @param initialQuery Raw search query string.
   * @param topK Maximum number of chunks to retrieve per query variation. Default: `5`
   * @param filter Key-value filter metadata object for multi-tenant isolation.
   * @returns Promise resolving to the final mutated RAGContext payload.
   */
  async executePipeline(
    initialQuery: string,
    topK = 5,
    filter?: Record<string, unknown>,
  ): Promise<RAGContext> {
    let ctx: RAGContext = {
      query: initialQuery,
      chunks: [],
      filter,
    };

    // Stage 1: Pre-retrieval strategies (Query Expansion, Synonyms, Sub-queries)
    for (const strat of this.preRetrievalStrategies) {
      ctx = await strat.process(ctx);
    }

    // Stage 2: Document Chunk Retrieval across original query and expanded sub-queries
    const queryList = [ctx.query, ...(ctx.expandedQueries || [])];
    const retrievedChunksMap = new Map<string, DocumentChunk>();
    const scoresMap = new Map<string, number>();

    for (const q of queryList) {
      if (!q || typeof q !== 'string' || !q.trim()) continue;
      const scoredChunks = await this.knowledgeBase.queryChunksScored(q, topK, ctx.filter);
      for (const { chunk, score } of scoredChunks) {
        retrievedChunksMap.set(chunk.id, chunk);
        // A chunk matched by more than one query variant keeps its best score.
        const existing = scoresMap.get(chunk.id);
        if (existing === undefined || score > existing) {
          scoresMap.set(chunk.id, score);
        }
      }
    }

    ctx.chunks = Array.from(retrievedChunksMap.values());
    ctx.scores = scoresMap;

    // Stage 3: Post-retrieval strategies (Reranking, Hydration, Contextual Compression, Graph Facts)
    for (const strat of this.postRetrievalStrategies) {
      ctx = await strat.process(ctx);
    }

    return ctx;
  }
}
