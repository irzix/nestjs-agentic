import type { DocumentChunk } from '../interfaces/document.interface';
import type { EmbeddingProvider } from '../interfaces/embedding.interface';
import type { RAGContext, RAGStrategy } from '../interfaces/strategy.interface';

/**
 * Options for configuring LateChunkingStrategy.
 */
export interface LateChunkingStrategyOptions {
  /** Optional embedding provider used to generate document-level global vectors and chunk-level local vectors. */
  embeddingProvider?: EmbeddingProvider;

  /** Blend ratio between local chunk vector and global document vector (0.0 to 1.0). Default: `0.7` */
  blendAlpha?: number;
}

/**
 * Post-retrieval RAG Strategy that blends document-level global embeddings into individual chunk vectors,
 * ensuring vector search retains document-wide contextual awareness alongside local chunk precision.
 */
export class LateChunkingStrategy implements RAGStrategy {
  readonly name = 'LateChunking';
  readonly phase = 'post-retrieval' as const;
  private readonly embeddingProvider?: EmbeddingProvider;
  private readonly blendAlpha: number;

  /**
   * Creates a new instance of LateChunkingStrategy.
   * @param options Configuration for embedding provider and blend alpha ratio.
   */
  constructor(options?: LateChunkingStrategyOptions) {
    this.embeddingProvider = options?.embeddingProvider;
    this.blendAlpha = options?.blendAlpha ?? 0.7;
  }

  /**
   * Applies late chunking vector blending to an array of document chunks.
   * Generates a global document embedding from all chunks and blends it into each chunk's local vector.
   * Can be used during document ingestion or retrieval preprocessing.
   *
   * @param chunks Array of DocumentChunk objects to apply late chunking to.
   * @returns Promise resolving to an array of DocumentChunk objects with blended embeddings.
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

  /**
   * Applies late chunking embedding blending to all retrieved chunks in the RAGContext.
   *
   * @param context RAGContext payload containing retrieved chunks.
   * @returns Promise resolving to updated RAGContext with blended chunk embeddings.
   */
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
