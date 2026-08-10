import type { DocumentChunk } from '../interfaces/document.interface';
import type { EmbeddingProvider } from '../interfaces/embedding.interface';
import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';

export interface LateChunkingStrategyOptions {
  embeddingProvider?: EmbeddingProvider;
  /** Blend ratio between local chunk vector and global doc vector (0.0 to 1.0). Default: 0.7 */
  blendAlpha?: number;
}

/**
 * Late Chunking Strategy: Blends document-level global embeddings into chunk vectors
 * to ensure high-precision vector search retains document-wide contextual awareness.
 */
export class LateChunkingStrategy implements RAGStrategy {
  readonly name = 'LateChunking';
  private readonly embeddingProvider?: EmbeddingProvider;
  private readonly blendAlpha: number;

  constructor(options?: LateChunkingStrategyOptions) {
    this.embeddingProvider = options?.embeddingProvider;
    this.blendAlpha = options?.blendAlpha ?? 0.7;
  }

  /**
   * Applies Late Chunking vector blending to an array of document chunks.
   * Can be used during document ingestion or retrieval preprocessing.
   */
  async processChunks(chunks: DocumentChunk[]): Promise<DocumentChunk[]> {
    if (!chunks || chunks.length === 0 || !this.embeddingProvider) {
      return chunks;
    }

    const docText = chunks.map((c) => c.content).join(' ');
    const globalEmbedding = await this.embeddingProvider.embedQuery(docText);

    return Promise.all(
      chunks.map(async (chunk) => {
        const chunkVector = chunk.embedding || (await this.embeddingProvider!.embedQuery(chunk.content));

        // Blend global doc vector into local chunk vector
        if (chunkVector.length === globalEmbedding.length) {
          const blendedVector = chunkVector.map(
            (val, i) => this.blendAlpha * val + (1 - this.blendAlpha) * globalEmbedding[i],
          );

          return {
            ...chunk,
            embedding: blendedVector,
            metadata: {
              ...chunk.metadata,
              lateChunkingApplied: true,
              blendAlpha: this.blendAlpha,
            },
          };
        }

        return chunk;
      }),
    );
  }

  async process(context: RAGContext): Promise<RAGContext> {
    if (!context.chunks || context.chunks.length === 0) {
      return context;
    }

    const enhancedChunks = await this.processChunks(context.chunks);
    return {
      ...context,
      chunks: enhancedChunks,
    };
  }
}
