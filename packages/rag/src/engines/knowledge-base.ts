import { randomUUID } from 'crypto';
import type { Document, DocumentChunk, DocumentSplitter } from '../interfaces/document.interface';
import type { ScoredDocumentChunk, VectorStoreAdapter } from '../interfaces/vector-store.interface';
import { SemanticDocumentSplitter } from '../splitters/semantic-document.splitter';
import { HybridVectorStore } from '../stores/hybrid-vector.store';

/**
 * Options for configuring KnowledgeBase engine.
 */
export interface KnowledgeBaseOptions {
  /** Document splitter implementation. Default: `SemanticDocumentSplitter` */
  splitter?: DocumentSplitter;

  /** Pluggable vector store adapter (HybridVectorStore or custom database adapter via VectorStoreFactory). */
  vectorStore?: VectorStoreAdapter;
}

/**
 * KnowledgeBase engine for ingesting, indexing, updating, and retrieving domain documents.
 */
export class KnowledgeBase {
  private readonly documents = new Map<string, Document>();
  private readonly splitter: DocumentSplitter;
  private readonly vectorStore: VectorStoreAdapter;

  /**
   * Creates a new instance of KnowledgeBase.
   * @param options Configuration options specifying document splitter and vector store adapter.
   */
  constructor(options?: KnowledgeBaseOptions) {
    this.splitter = options?.splitter ?? new SemanticDocumentSplitter();
    this.vectorStore = options?.vectorStore ?? new HybridVectorStore();
  }

  /**
   * Ingests a raw domain document, splits it into chunks using the configured splitter, and indexes it into the vector store.
   *
   * @param document Raw document input containing title, rawContent, optional ID, and metadata.
   * @returns Promise resolving to the ingested Document with generated chunks.
   */
  async ingestDocument(document: Partial<Document> & { title: string; rawContent: string }): Promise<Document> {
    const docId = document.id || randomUUID();
    const fullDoc: Document = {
      id: docId,
      title: document.title,
      rawContent: document.rawContent,
      chunks: [],
      metadata: document.metadata || {},
      timestamp: document.timestamp || new Date(),
    };

    const chunks = await this.splitter.splitDocument(fullDoc);
    fullDoc.chunks = chunks;

    this.documents.set(docId, fullDoc);
    if (this.vectorStore.addChunks) {
      await this.vectorStore.addChunks(chunks);
    }

    return fullDoc;
  }

  /**
   * Retrieves an ingested Document by its unique identifier.
   *
   * @param documentId Unique document identifier.
   * @returns Ingested Document object or undefined if not found.
   */
  getDocument(documentId: string): Document | undefined {
    return this.documents.get(documentId);
  }

  /**
   * Performs vector similarity search across ingested documents in the KnowledgeBase.
   *
   * @param query Search query prompt string.
   * @param limit Maximum number of matching chunks to return. Default: `5`
   * @param filter Key-value filter metadata object for multi-tenant isolation or tags.
   * @returns Promise resolving to an array of matching DocumentChunk objects.
   */
  async queryChunks(query: string, limit = 5, filter?: Record<string, unknown>): Promise<DocumentChunk[]> {
    const chunks = await this.vectorStore.searchChunks(query, limit, filter);
    return chunks.map((chunk) => KnowledgeBase.tagExternal(chunk));
  }

  /**
   * Same as `queryChunks`, but also returns each chunk's relevance score.
   *
   * Uses the adapter's `searchChunksScored` when available. Otherwise falls
   * back to a synthetic descending rank-based score (`1 / (rank + 1)`), so
   * callers always get a usable score even from an adapter that can't
   * produce a real one.
   *
   * @param query Search query prompt string.
   * @param limit Maximum number of matching chunks to return. Default: `5`
   * @param filter Key-value filter metadata object for multi-tenant isolation or tags.
   * @returns Promise resolving to an array of chunks paired with their relevance score.
   */
  async queryChunksScored(
    query: string,
    limit = 5,
    filter?: Record<string, unknown>,
  ): Promise<ScoredDocumentChunk[]> {
    if (this.vectorStore.searchChunksScored) {
      const scored = await this.vectorStore.searchChunksScored(query, limit, filter);
      return scored.map(({ chunk, score }) => ({ chunk: KnowledgeBase.tagExternal(chunk), score }));
    }

    const chunks = await this.vectorStore.searchChunks(query, limit, filter);
    return chunks.map((chunk, rank) => ({ chunk: KnowledgeBase.tagExternal(chunk), score: 1 / (rank + 1) }));
  }

  /**
   * Stamps a retrieved chunk with `external` provenance. Retrieval is a trust
   * boundary: whatever a (possibly custom or compromised) vector store returns is
   * untrusted content, so the framework always assigns `{ source: 'external' }`
   * here rather than trusting a caller-supplied label. This prevents a store from
   * laundering external content as `model`/`user` to weaken downstream guardrails.
   */
  private static tagExternal(chunk: DocumentChunk): DocumentChunk {
    return { ...chunk, provenance: { source: 'external', origin: chunk.parentId } };
  }

  /**
   * Gets the underlying VectorStoreAdapter instance for direct memory or vector operations.
   *
   * @returns Pluggable VectorStoreAdapter instance.
   */
  getVectorStore(): VectorStoreAdapter {
    return this.vectorStore;
  }
}
