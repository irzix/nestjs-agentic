import type { MemoryRecord, SemanticMatch, SemanticStoreProvider } from '@nestjs-agentic/memory';
import type { DocumentChunk } from '../interfaces/document.interface';
import type { EmbeddingProvider } from '../interfaces/embedding.interface';
import type { VectorStoreAdapter } from '../interfaces/vector-store.interface';

/**
 * Options for configuring HybridVectorStore.
 */
export interface HybridVectorStoreOptions {
  /** Optional embedding provider for generating vector representations of text. */
  embeddingProvider?: EmbeddingProvider;

  /** Weight assigned to dense vector similarity vs sparse BM25 keyword match (0.0 to 1.0). Default: `0.5` */
  vectorWeight?: number;

  /** Optional custom stop-words set to filter out during BM25 keyword matching. */
  stopWords?: Set<string> | string[];

  /** BM25 term-frequency saturation constant. Default: `1.2` */
  bm25K1?: number;

  /** BM25 document-length normalization constant (0.0 to 1.0). Default: `0.75` */
  bm25B?: number;
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
   * Ingests or updates document chunks with parallel batch embedding generation.
   *
   * @param chunks Array of DocumentChunk objects to ingest.
   * @returns Promise resolving when ingestion and embedding generation is complete.
   */
  async addChunks(chunks: DocumentChunk[]): Promise<void> {
    if (!chunks || chunks.length === 0) return;

    const chunksNeedingEmbed = chunks.filter((c) => !c.embedding);

    if (chunksNeedingEmbed.length > 0 && this.embeddingProvider) {
      const embeddings = await Promise.all(
        chunksNeedingEmbed.map((c) => this.embeddingProvider!.embedQuery(c.content)),
      );

      for (let i = 0; i < chunksNeedingEmbed.length; i++) {
        chunksNeedingEmbed[i].embedding = embeddings[i];
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

      let vectorScore = 0;
      if (queryVector && chunk.embedding && queryVector.length === chunk.embedding.length) {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < queryVector.length; i++) {
          dotProduct += queryVector[i] * chunk.embedding[i];
          normA += queryVector[i] * queryVector[i];
          normB += chunk.embedding[i] * chunk.embedding[i];
        }
        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        vectorScore = denominator > 0 ? dotProduct / denominator : 0;
      }

      return { chunk, bm25Score, vectorScore };
    });

    const maxBm = Math.max(...rawScores.map((s) => s.bm25Score), 0.0001);
    const maxVec = Math.max(...rawScores.map((s) => s.vectorScore), 0.0001);

    const scored = rawScores.map(({ chunk, bm25Score, vectorScore }) => {
      const normBm = bm25Score / maxBm;
      const normVec = vectorScore / maxVec;
      const combinedScore = bmWeight * normBm + this.vectorWeight * normVec;
      return { chunk, combinedScore };
    });

    scored.sort((a, b) => b.combinedScore - a.combinedScore);
    return scored
      .filter((s) => s.combinedScore > 0)
      .slice(0, limit)
      .map((s) => s.chunk);
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
    const chunks = await this.searchHybrid(query, limit, filter);
    return chunks.map((c) => ({
      record: {
        id: c.id,
        sessionId: (c.metadata?.sessionId as string) ?? c.parentId,
        type: (c.metadata?.type as string) ?? 'semantic',
        content: c.content,
        metadata: c.metadata,
      },
      score: 1.0,
    }));
  }
}
