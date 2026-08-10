import type { DocumentChunk } from '../interfaces/document.interface';
import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';
import type { KnowledgeBase } from './knowledge-base';

export interface RAGPipelineOptions {
  knowledgeBase: KnowledgeBase;
  /** Strategies to execute before retrieval (e.g. QueryExpansionStrategy). */
  preRetrievalStrategies?: RAGStrategy[];
  /** Strategies to execute after retrieval (e.g. GraphRAG, Hierarchical, Hydration, Reranker, Compression). */
  postRetrievalStrategies?: RAGStrategy[];
  /** Single list of strategies automatically partitioned into pre/post retrieval stages. */
  strategies?: RAGStrategy[];
}

/**
 * Advanced RAG Execution Pipeline orchestrating Query Expansion, Hybrid Retrieval,
 * Graph RAG, Hierarchical Tree Rollup, Hydration, Re-ranking, and Contextual Compression.
 */
export class RAGPipeline {
  private readonly knowledgeBase: KnowledgeBase;
  private readonly preRetrievalStrategies: RAGStrategy[] = [];
  private readonly postRetrievalStrategies: RAGStrategy[] = [];

  constructor(options: RAGPipelineOptions) {
    this.knowledgeBase = options.knowledgeBase;

    if (options.preRetrievalStrategies) {
      this.preRetrievalStrategies.push(...options.preRetrievalStrategies);
    }
    if (options.postRetrievalStrategies) {
      this.postRetrievalStrategies.push(...options.postRetrievalStrategies);
    }

    // Auto-partition strategies if single array provided
    if (options.strategies) {
      for (const s of options.strategies) {
        if (s.name === 'QueryExpansion') {
          this.preRetrievalStrategies.push(s);
        } else {
          this.postRetrievalStrategies.push(s);
        }
      }
    }
  }

  /**
   * Executes the full RAG pipeline for an input user query with multi-tenant filtering.
   *
   * @param query Raw input user or agent query string.
   * @param limit Maximum candidate chunks to retrieve initially.
   * @param filter Optional metadata filter bag (e.g. { tenantId: 'acme_corp' }).
   * @returns Final processed RAGContext ready for prompt insertion.
   */
  async executePipeline(
    query: string,
    limit = 5,
    filter?: Record<string, unknown>,
  ): Promise<RAGContext> {
    let context: RAGContext = { query, metadata: filter };

    // Stage 1: Pre-Retrieval Strategies (e.g. Query Expansion)
    for (const strategy of this.preRetrievalStrategies) {
      context = await strategy.process(context);
    }

    // Stage 2: Candidate Chunk Retrieval across query & expanded variations
    const queriesToSearch = context.expandedQueries?.length ? context.expandedQueries : [context.query];
    const retrievedChunkMap = new Map<string, DocumentChunk>();

    for (const q of queriesToSearch) {
      const chunks = await this.knowledgeBase.queryChunks(q, limit, filter);
      for (const c of chunks) {
        retrievedChunkMap.set(c.id, c);
      }
    }

    context.chunks = Array.from(retrievedChunkMap.values());

    // Stage 3: Post-Retrieval Strategies (e.g. Graph, Hierarchical, Hydration, Reranker, Compression)
    for (const strategy of this.postRetrievalStrategies) {
      context = await strategy.process(context);
    }

    return context;
  }
}
