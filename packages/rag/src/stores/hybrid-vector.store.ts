import type { MemoryRecord, SemanticMatch, SemanticStoreProvider } from '@nestjs-agentic/memory';
import type { DocumentChunk } from '../interfaces/document.interface';
import type { EmbeddingProvider } from '../interfaces/embedding.interface';

export interface HybridVectorStoreOptions {
  embeddingProvider?: EmbeddingProvider;
  /** Weight assigned to dense vector similarity vs sparse BM25 keyword match (0.0 to 1.0). Default: 0.5 */
  vectorWeight?: number;
  /** Optional custom stop-words set to filter out during BM25 keyword matching. */
  stopWords?: Set<string> | string[];
}

/**
 * Hybrid Vector Store combining dense vector similarity search with sparse BM25 term matching.
 * Features parallel batch ingestion, upsert semantics, Min-Max score normalization,
 * metadata filtering, and direct @nestjs-agentic/memory integration.
 */
export class HybridVectorStore implements SemanticStoreProvider {
  private readonly chunksMap = new Map<string, DocumentChunk>();
  private readonly embeddingProvider?: EmbeddingProvider;
  private readonly vectorWeight: number;
  private readonly stopWordsSet?: Set<string>;

  constructor(options?: HybridVectorStoreOptions) {
    this.embeddingProvider = options?.embeddingProvider;
    this.vectorWeight = options?.vectorWeight ?? 0.5;

    if (options?.stopWords) {
      this.stopWordsSet = new Set(Array.from(options.stopWords).map((w) => w.toLowerCase()));
    }
  }

  /**
   * Ingests or updates document chunks with parallel batch embedding generation.
   */
  async addChunks(chunks: DocumentChunk[]): Promise<void> {
    if (!chunks || chunks.length === 0) return;

    // Filter chunks needing embeddings
    const chunksNeedingEmbed = chunks.filter((c) => !c.embedding);

    if (chunksNeedingEmbed.length > 0 && this.embeddingProvider) {
      // Parallel batch embedding generation
      const embeddings = await Promise.all(
        chunksNeedingEmbed.map((c) => this.embeddingProvider!.embedQuery(c.content)),
      );

      for (let i = 0; i < chunksNeedingEmbed.length; i++) {
        chunksNeedingEmbed[i].embedding = embeddings[i];
      }
    }

    // Upsert chunks into Map to avoid memory leaks and duplicates
    for (const chunk of chunks) {
      this.chunksMap.set(chunk.id, chunk);
    }
  }

  /**
   * Deletes a chunk by its unique ID.
   */
  deleteChunk(chunkId: string): boolean {
    return this.chunksMap.delete(chunkId);
  }

  /**
   * Clears all stored chunks.
   */
  clear(): void {
    this.chunksMap.clear();
  }

  /**
   * Performs hybrid vector search combining BM25 keyword matching and dense cosine similarity,
   * with Min-Max score normalization and metadata filtering.
   */
  async searchHybrid(
    query: string,
    limit = 5,
    filter?: Record<string, unknown>,
  ): Promise<DocumentChunk[]> {
    if (this.chunksMap.size === 0) return [];

    const queryTokens = new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0 && (!this.stopWordsSet || !this.stopWordsSet.has(t))),
    );

    const queryVector = this.embeddingProvider ? await this.embeddingProvider.embedQuery(query) : undefined;
    const bmWeight = 1 - this.vectorWeight;

    let chunksToSearch = Array.from(this.chunksMap.values());

    // 1. Apply metadata filtering if provided (Multi-tenant isolation)
    if (filter) {
      chunksToSearch = chunksToSearch.filter((chunk) => {
        for (const [key, value] of Object.entries(filter)) {
          if (chunk.metadata?.[key] !== value) return false;
        }
        return true;
      });
    }

    if (chunksToSearch.length === 0) return [];

    // 2. Compute raw BM25 and Vector similarity scores
    const rawScores = chunksToSearch.map((chunk) => {
      const tokens = chunk.content.toLowerCase().split(/\s+/);
      let matchCount = 0;
      for (const t of tokens) {
        if (queryTokens.has(t)) matchCount++;
      }
      const bm25Score = matchCount / Math.max(tokens.length, 1);

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

    // 3. Min-Max Normalization to balance BM25 and Vector score distributions
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

  // --- SemanticStoreProvider Implementation for @nestjs-agentic/memory ---

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
