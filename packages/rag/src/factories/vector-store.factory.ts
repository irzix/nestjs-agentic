import type { DocumentChunk } from '../interfaces/document.interface';
import type { EmbeddingProvider } from '../interfaces/embedding.interface';
import type { VectorStoreAdapter } from '../interfaces/vector-store.interface';
import { HybridVectorStore, HybridVectorStoreOptions } from '../stores/hybrid-vector.store';

/**
 * Options for creating a custom VectorStoreAdapter.
 */
export interface CustomVectorStoreOptions {
  /** Optional custom adapter name. Default: `'CustomVectorStoreAdapter'` */
  name?: string;

  /** Custom search function connecting to any vector database or service (e.g. Prisma + pgvector). */
  searchFn: (
    query: string,
    limit: number,
    filter?: Record<string, unknown>,
    queryVector?: number[],
  ) => Promise<DocumentChunk[]> | DocumentChunk[];

  /** Optional custom chunk ingestion function. */
  addChunksFn?: (chunks: DocumentChunk[]) => Promise<void> | void;

  /** Optional custom chunk deletion function. */
  deleteChunkFn?: (chunkId: string) => Promise<boolean> | boolean;

  /** Optional clear function. */
  clearFn?: () => Promise<void> | void;
}

/**
 * Options for creating a dedicated PostgreSQL / pgvector adapter.
 */
export interface PgVectorOptions {
  /** Query function executing raw SQL or Prisma pgvector distance query (`<=>` or `<->`). */
  queryFn: (
    queryVector: number[],
    limit: number,
    filter?: Record<string, unknown>,
  ) => Promise<DocumentChunk[]> | DocumentChunk[];

  /** Optional chunk ingestion function. */
  addChunksFn?: (chunks: DocumentChunk[], embeddings: number[][]) => Promise<void> | void;

  /** Optional embedding provider to automatically embed search queries. */
  embeddingProvider?: EmbeddingProvider;
}

/**
 * Factory class for creating VectorStoreAdapter implementations across verschieden vector store databases (pgvector, Custom Services, In-Memory).
 */
export class VectorStoreFactory {
  /**
   * Creates an in-memory HybridVectorStore instance.
   * @param options HybridVectorStore options.
   */
  static createInMemory(options?: HybridVectorStoreOptions): HybridVectorStore {
    return new HybridVectorStore(options);
  }

  /**
   * Creates a custom VectorStoreAdapter wrapping developer-supplied search and ingestion closures (e.g. Prisma + pgvector in Codor).
   *
   * @example
   * ```typescript
   * const vectorStore = VectorStoreFactory.createCustom({
   *   searchFn: async (query, limit, filter, vector) => {
   *     return await vectorStoreService.search(vector, limit, filter);
   *   }
   * });
   * ```
   */
  static createCustom(options: CustomVectorStoreOptions): VectorStoreAdapter {
    return {
      name: options.name || 'CustomVectorStoreAdapter',
      async addChunks(chunks: DocumentChunk[]) {
        if (options.addChunksFn) {
          await options.addChunksFn(chunks);
        }
      },
      async deleteChunk(chunkId: string) {
        if (options.deleteChunkFn) {
          return await options.deleteChunkFn(chunkId);
        }
        return false;
      },
      async clear() {
        if (options.clearFn) {
          await options.clearFn();
        }
      },
      async searchChunks(query: string, limit = 5, filter?: Record<string, unknown>, queryVector?: number[]) {
        return await options.searchFn(query, limit, filter, queryVector);
      },
    };
  }

  /**
   * Factory method for creating a dedicated PostgreSQL / pgvector store adapter.
   *
   * @example
   * ```typescript
   * const vectorStore = VectorStoreFactory.createPgVector({
   *   embeddingProvider: new CustomEmbeddingAdapter((texts) => embeddingService.embed(texts)),
   *   queryFn: async (queryVector, limit, filter) => {
   *     return await prisma.$queryRaw`SELECT * FROM chunks ORDER BY embedding <=> ${queryVector} LIMIT ${limit}`;
   *   }
   * });
   * ```
   */
  static createPgVector(options: PgVectorOptions): VectorStoreAdapter {
    return {
      name: 'PgVectorAdapter',
      async addChunks(chunks: DocumentChunk[], embeddings?: number[][]) {
        if (options.addChunksFn && embeddings) {
          await options.addChunksFn(chunks, embeddings);
        }
      },
      async searchChunks(query: string, limit = 5, filter?: Record<string, unknown>, queryVector?: number[]) {
        let vec = queryVector;
        if (!vec && options.embeddingProvider) {
          vec = await options.embeddingProvider.embedQuery(query);
        }
        if (!vec) {
          throw new Error('PgVectorAdapter requires a queryVector or embeddingProvider to perform vector similarity search.');
        }
        return await options.queryFn(vec, limit, filter);
      },
    };
  }
}
