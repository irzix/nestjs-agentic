import type { MemoryRecord, SemanticMatch, SemanticStoreProvider } from '@nestjs-agentic/memory';
import type { DocumentChunk } from '../interfaces/document.interface';
import type { EmbeddingProvider } from '../interfaces/embedding.interface';
import type { ScoredDocumentChunk, VectorStoreAdapter } from '../interfaces/vector-store.interface';
import { reciprocalRankFusion } from '../utils/rrf-fusion';
import { cosineSimilarity } from '../utils/cosine-similarity';

/**
 * Options for configuring HybridVectorStore.
 */
export interface HybridVectorStoreOptions {
  /** Optional embedding provider for generating vector representations of text. */
  embeddingProvider?: EmbeddingProvider;

  /** Weight assigned to dense vector similarity vs sparse BM25 keyword match (0.0 to 1.0). Default: `0.5` */
  vectorWeight?: number;

  /**
   * How dense and sparse rankings are combined. `'weighted'` blends max-normalized
   * raw scores; `'rrf'` uses Reciprocal Rank Fusion over the two rankers' rank
   * positions instead, avoiding cross-scale score normalization. Default: `'weighted'`
   */
  fusionMethod?: 'weighted' | 'rrf';

  /** RRF smoothing constant `k`, used only when `fusionMethod: 'rrf'`. Default: `60` */
  rrfK?: number;

  /** Optional custom stop-words set to filter out during BM25 keyword matching. */
  stopWords?: Set<string> | string[];

  /** BM25 term-frequency saturation constant. Default: `1.2` */
  bm25K1?: number;

  /** BM25 document-length normalization constant (0.0 to 1.0). Default: `0.75` */
  bm25B?: number;

  /**
   * Maximum number of chunks embedded per `embedDocuments` call. `addChunks`
   * batches unembedded chunks into groups of this size rather than issuing
   * one call per chunk or one unbounded call for the whole input, since most
   * embedding providers cap request size. Default: `100`
   */
  embeddingBatchSize?: number;
}

/**
 * Hybrid Vector Store combining dense vector similarity search with sparse BM25 term matching.
 * Features parallel batch ingestion, upsert semantics, Min-Max score normalization,
 * metadata filtering, and direct @nestjs-agentic/memory integration.
 */
export class HybridVectorStore implements SemanticStoreProvider, VectorStoreAdapter {
  readonly name = 'HybridVectorStore';
  private readonly chunksMap = new Map<string, DocumentChunk>();
  private readonly embeddingProvider?: EmbeddingProvider;
  private readonly vectorWeight: number;
  private readonly stopWordsSet?: Set<string>;
  private readonly bm25K1: number;
  private readonly bm25B: number;
  private readonly embeddingBatchSize: number;
  private readonly fusionMethod: 'weighted' | 'rrf';
  private readonly rrfK: number;

  /** Per-chunk term-frequency map, kept so `deleteChunk`/re-ingestion can decrement corpus stats without re-tokenizing. */
  private readonly chunkTermFreqs = new Map<string, Map<string, number>>();
  /** Number of chunks each term appears in at least once, i.e. document frequency for IDF. */
  private readonly docFreq = new Map<string, number>();
  /** Sum of token counts across all indexed chunks, for the average-document-length term in BM25. */
  private totalTokenCount = 0;

  /**
   * Creates a new instance of HybridVectorStore.
   * @param options Configuration options for vector weighting, stop words, and embedding provider.
   */
  constructor(options?: HybridVectorStoreOptions) {
    this.embeddingProvider = options?.embeddingProvider;
    this.vectorWeight = options?.vectorWeight ?? 0.5;
    this.bm25K1 = options?.bm25K1 ?? 1.2;
    this.bm25B = options?.bm25B ?? 0.75;
    this.fusionMethod = options?.fusionMethod ?? 'weighted';
    this.rrfK = options?.rrfK ?? 60;

    const batchSize = options?.embeddingBatchSize ?? 100;
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
      throw new RangeError(
        `HybridVectorStore: embeddingBatchSize must be a positive integer, got ${batchSize}`,
      );
    }
    this.embeddingBatchSize = batchSize;

    if (options?.stopWords) {
      this.stopWordsSet = new Set(Array.from(options.stopWords).map((w) => w.toLowerCase()));
    }
  }

  /** Tokenizes chunk content the same way for indexing and querying, applying configured stop words. */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0 && (!this.stopWordsSet || !this.stopWordsSet.has(t)));
  }

  /** Removes a chunk's terms from the corpus-level document-frequency and token-count statistics. */
  private removeFromCorpusStats(chunkId: string): void {
    const termFreq = this.chunkTermFreqs.get(chunkId);
    if (!termFreq) return;

    for (const [term, count] of termFreq) {
      this.totalTokenCount -= count;
      const df = this.docFreq.get(term);
      if (df === undefined) continue;
      if (df <= 1) {
        this.docFreq.delete(term);
      } else {
        this.docFreq.set(term, df - 1);
      }
    }

    this.chunkTermFreqs.delete(chunkId);
  }

  /** Indexes a chunk's terms into the corpus-level document-frequency and token-count statistics. */
  private addToCorpusStats(chunk: DocumentChunk): void {
    const tokens = this.tokenize(chunk.content);
    const termFreq = new Map<string, number>();

    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }

    for (const term of termFreq.keys()) {
      this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }

    this.totalTokenCount += tokens.length;
    this.chunkTermFreqs.set(chunk.id, termFreq);
  }

  /** Average document length (in tokens) across the indexed corpus, for BM25's length-normalization term. */
  private get avgDocLength(): number {
    return this.chunksMap.size > 0 ? this.totalTokenCount / this.chunksMap.size : 0;
  }

  /** Inverse document frequency for a term, using the standard BM25 (Robertson/Sparck-Jones) formula. */
  private idf(term: string): number {
    const n = this.chunksMap.size;
    const df = this.docFreq.get(term) ?? 0;
    return Math.log((n - df + 0.5) / (df + 0.5) + 1);
  }

  /**
   * Computes the BM25 relevance score of a chunk against a set of query terms,
   * using corpus-level IDF and length-normalized term frequency.
   */
  private bm25Score(chunkId: string, queryTermCounts: Map<string, number>): number {
    const termFreq = this.chunkTermFreqs.get(chunkId);
    if (!termFreq) return 0;

    const docLength = this.totalTermCount(termFreq);
    const avgDl = this.avgDocLength || 1;

    let score = 0;
    for (const term of queryTermCounts.keys()) {
      const f = termFreq.get(term) ?? 0;
      if (f === 0) continue;

      const idf = this.idf(term);
      const numerator = f * (this.bm25K1 + 1);
      const denominator = f + this.bm25K1 * (1 - this.bm25B + this.bm25B * (docLength / avgDl));
      score += idf * (numerator / denominator);
    }

    return score;
  }

  private totalTermCount(termFreq: Map<string, number>): number {
    let total = 0;
    for (const count of termFreq.values()) total += count;
    return total;
  }

  /**
   * Ingests or updates document chunks, embedding any that don't already
   * carry a vector.
   *
   * Unembedded chunks are embedded via `embedDocuments()` in batches of
   * `embeddingBatchSize` rather than one `embedQuery()` call per chunk, so
   * ingesting hundreds of chunks issues a handful of batched requests
   * instead of hundreds of individual ones.
   *
   * Mutates the input `DocumentChunk` objects in place to attach the
   * generated `embedding` — this is intentional, not an oversight: callers
   * such as `KnowledgeBase.ingestDocument` pass the same array they keep a
   * reference to, and rely on seeing the embedding on it afterward.
   *
   * @param chunks Array of DocumentChunk objects to ingest.
   * @returns Promise resolving when ingestion and embedding generation is complete.
   */
  async addChunks(chunks: DocumentChunk[]): Promise<void> {
    if (!chunks || chunks.length === 0) return;

    const chunksNeedingEmbed = chunks.filter((c) => !c.embedding);

    if (chunksNeedingEmbed.length > 0 && this.embeddingProvider) {
      for (let i = 0; i < chunksNeedingEmbed.length; i += this.embeddingBatchSize) {
        const batch = chunksNeedingEmbed.slice(i, i + this.embeddingBatchSize);
        const embeddings = await this.embeddingProvider.embedDocuments(batch.map((c) => c.content));

        if (embeddings.length !== batch.length) {
          throw new Error(
            `HybridVectorStore: embedding provider "${this.embeddingProvider.constructor?.name ?? 'unknown'}" ` +
              `returned ${embeddings.length} embedding(s) for a batch of ${batch.length} chunk(s). ` +
              `A misaligned response would silently attach wrong or undefined embeddings.`,
          );
        }

        for (let j = 0; j < batch.length; j++) {
          batch[j].embedding = embeddings[j];
        }
      }
    }

    for (const chunk of chunks) {
      // Upsert: an existing chunk's terms must be removed from corpus stats
      // before re-indexing, otherwise its document frequency/token counts
      // would be double-counted.
      if (this.chunksMap.has(chunk.id)) {
        this.removeFromCorpusStats(chunk.id);
      }
      this.chunksMap.set(chunk.id, chunk);
      this.addToCorpusStats(chunk);
    }
  }

  /**
   * Deletes a chunk from the store by its unique identifier.
   *
   * @param chunkId Unique chunk identifier.
   * @returns Boolean indicating whether the chunk was found and removed.
   */
  deleteChunk(chunkId: string): boolean {
    this.removeFromCorpusStats(chunkId);
    return this.chunksMap.delete(chunkId);
  }

  /**
   * Clears all stored document chunks from memory.
   */
  clear(): void {
    this.chunksMap.clear();
    this.chunkTermFreqs.clear();
    this.docFreq.clear();
    this.totalTokenCount = 0;
  }

  /**
   * Performs hybrid vector search combining BM25 keyword matching and dense cosine similarity,
   * with Min-Max score normalization and metadata filtering.
   *
   * @param query Search query string.
   * @param limit Maximum number of matching chunks to return. Default: `5`
   * @param filter Key-value metadata object for filtering chunks (e.g. multi-tenant isolation).
   * @returns Promise resolving to an array of ranked DocumentChunk objects.
   */
  async searchHybrid(
    query: string,
    limit = 5,
    filter?: Record<string, unknown>,
  ): Promise<DocumentChunk[]> {
    const scored = await this.searchHybridScored(query, limit, filter);
    return scored.map((s) => s.chunk);
  }

  /**
   * Same as `searchHybrid`, but returns each chunk's fused BM25+cosine score alongside it.
   *
   * @param query Search query string.
   * @param limit Maximum number of matching chunks to return. Default: `5`
   * @param filter Key-value metadata object for filtering chunks (e.g. multi-tenant isolation).
   * @returns Promise resolving to chunks paired with their normalized, weighted BM25+cosine
   *   score, sorted descending.
   */
  async searchHybridScored(
    query: string,
    limit = 5,
    filter?: Record<string, unknown>,
  ): Promise<ScoredDocumentChunk[]> {
    if (this.chunksMap.size === 0) return [];

    const queryTokens = this.tokenize(query);
    const queryTermCounts = new Map<string, number>();
    for (const t of queryTokens) {
      queryTermCounts.set(t, (queryTermCounts.get(t) ?? 0) + 1);
    }

    const queryVector = this.embeddingProvider ? await this.embeddingProvider.embedQuery(query) : undefined;
    const bmWeight = 1 - this.vectorWeight;

    let chunksToSearch = Array.from(this.chunksMap.values());

    if (filter) {
      chunksToSearch = chunksToSearch.filter((chunk) => {
        for (const [key, value] of Object.entries(filter)) {
          if (chunk.metadata?.[key] !== value) return false;
        }
        return true;
      });
    }

    if (chunksToSearch.length === 0) return [];

    const rawScores = chunksToSearch.map((chunk) => {
      const bm25Score = this.bm25Score(chunk.id, queryTermCounts);

      const vectorScore = queryVector && chunk.embedding ? cosineSimilarity(queryVector, chunk.embedding) : 0;

      return { chunk, bm25Score, vectorScore };
    });

    let scored: ScoredDocumentChunk[];

    if (this.fusionMethod === 'rrf') {
      scored = this.fuseByRrf(rawScores, bmWeight);
    } else {
      const maxBm = Math.max(...rawScores.map((s) => s.bm25Score), 0.0001);
      const maxVec = Math.max(...rawScores.map((s) => s.vectorScore), 0.0001);

      scored = rawScores.map(({ chunk, bm25Score, vectorScore }) => {
        const normBm = bm25Score / maxBm;
        const normVec = vectorScore / maxVec;
        const combinedScore = bmWeight * normBm + this.vectorWeight * normVec;
        return { chunk, score: combinedScore };
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score > 0).slice(0, limit);
  }

  /**
   * Fuses the sparse (BM25) and dense (cosine) rankings by rank position via RRF,
   * instead of blending their raw scores. Each ranker only ranks chunks it scored
   * above zero, so a chunk absent from one ranking contributes nothing from it.
   */
  private fuseByRrf(
    rawScores: Array<{ chunk: DocumentChunk; bm25Score: number; vectorScore: number }>,
    bmWeight: number,
  ): ScoredDocumentChunk[] {
    const chunksById = new Map(rawScores.map((s) => [s.chunk.id, s.chunk]));

    const bm25Ranked = rawScores
      .filter((s) => s.bm25Score > 0)
      .sort((a, b) => b.bm25Score - a.bm25Score)
      .map((s) => s.chunk.id);
    const vectorRanked = rawScores
      .filter((s) => s.vectorScore > 0)
      .sort((a, b) => b.vectorScore - a.vectorScore)
      .map((s) => s.chunk.id);

    const fused = reciprocalRankFusion([bm25Ranked, vectorRanked], {
      k: this.rrfK,
      weights: [bmWeight, this.vectorWeight],
    });

    return Array.from(fused.entries()).map(([id, score]) => ({ chunk: chunksById.get(id)!, score }));
  }

  /**
   * Alias method fulfilling the VectorStoreAdapter interface.
   *
   * @param query Search query string.
   * @param limit Maximum number of matching chunks to return. Default: `5`
   * @param filter Key-value metadata object for filtering chunks.
   * @returns Promise resolving to matching DocumentChunk objects.
   */
  async searchChunks(
    query: string,
    limit = 5,
    filter?: Record<string, unknown>,
  ): Promise<DocumentChunk[]> {
    return await this.searchHybrid(query, limit, filter);
  }

  /**
   * Alias method fulfilling `VectorStoreAdapter.searchChunksScored`.
   *
   * @param query Search query string.
   * @param limit Maximum number of matching chunks to return. Default: `5`
   * @param filter Key-value metadata object for filtering chunks.
   * @returns Promise resolving to chunks paired with their fused BM25+cosine score.
   */
  async searchChunksScored(
    query: string,
    limit = 5,
    filter?: Record<string, unknown>,
  ): Promise<ScoredDocumentChunk[]> {
    return await this.searchHybridScored(query, limit, filter);
  }

  /**
   * Saves a memory record into the vector store for semantic memory integration.
   *
   * @param record MemoryRecord to persist.
   * @param embedding Optional vector embedding array.
   */
  async save(record: MemoryRecord, embedding?: number[]): Promise<void> {
    await this.addChunks([
      {
        id: record.id,
        parentId: record.sessionId,
        content: record.content,
        embedding,
        metadata: {
          sessionId: record.sessionId,
          type: record.type,
          ...record.metadata,
        },
      },
    ]);
  }

  /**
   * Searches the store and converts results into SemanticMatch objects for @nestjs-agentic/memory.
   *
   * @param query Search query string.
   * @param limit Maximum number of matches to return. Default: `5`
   * @param filter Key-value metadata filter object.
   * @returns Promise resolving to array of SemanticMatch items.
   */
  async search(query: string, limit = 5, filter?: Record<string, unknown>): Promise<SemanticMatch[]> {
    const scored = await this.searchHybridScored(query, limit, filter);
    return scored.map(({ chunk, score }) => {
      const sessionId = chunk.metadata?.sessionId;
      const type = chunk.metadata?.type;
      return {
        record: {
          id: chunk.id,
          sessionId: typeof sessionId === 'string' ? sessionId : chunk.parentId,
          type: typeof type === 'string' ? type : 'semantic',
          content: chunk.content,
          metadata: chunk.metadata,
        },
        score,
      };
    });
  }
}
