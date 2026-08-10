import type { DocumentChunk } from './document.interface';

/**
 * Interface defining a pluggable vector store database adapter (e.g. pgvector/Prisma, Pinecone, Qdrant, Chroma, In-Memory).
 */
export interface VectorStoreAdapter {
  /** Unique name of the vector store adapter implementation. */
  readonly name: string;

  /**
   * Ingests or updates document chunks in the target vector store database.
   * @param chunks Array of document chunks.
   * @param embeddings Optional array of embedding vector floats corresponding to each chunk.
   */
  addChunks?(chunks: DocumentChunk[], embeddings?: number[][]): Promise<void>;

  /**
   * Deletes a chunk by its unique ID.
   * @param chunkId Unique chunk identifier.
   */
  deleteChunk?(chunkId: string): Promise<boolean> | boolean;

  /**
   * Clears all stored chunks in the vector store database.
   */
  clear?(): Promise<void> | void;

  /**
   * Performs vector or hybrid similarity search in the underlying vector store database.
   * @param query Search query string.
   * @param limit Maximum number of matching chunks to return. Default: `5`
   * @param filter Key-value filter metadata object for multi-tenant isolation or tags.
   * @param queryVector Optional vector embedding array of the search query.
   */
  searchChunks(
    query: string,
    limit?: number,
    filter?: Record<string, unknown>,
    queryVector?: number[],
  ): Promise<DocumentChunk[]>;
}
