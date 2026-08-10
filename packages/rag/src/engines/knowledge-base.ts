import { randomUUID } from 'crypto';
import type { Document, DocumentChunk, DocumentSplitter } from '../interfaces/document.interface';
import type { VectorStoreAdapter } from '../interfaces/vector-store.interface';
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

  constructor(options?: KnowledgeBaseOptions) {
    this.splitter = options?.splitter ?? new SemanticDocumentSplitter();
    this.vectorStore = options?.vectorStore ?? new HybridVectorStore();
  }

  /**
   * Ingests a raw domain document, splits it into chunks, and indexes it into the vector store.
   *
   * @param document Raw document input containing title and content.
   * @returns Ingested Document with generated chunks.
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
   * Retrieves an ingested Document by its unique ID.
   */
  getDocument(documentId: string): Document | undefined {
    return this.documents.get(documentId);
  }

  /**
   * Performs hybrid vector search across ingested documents in the KnowledgeBase.
   */
  async queryChunks(query: string, limit = 5, filter?: Record<string, unknown>): Promise<DocumentChunk[]> {
    return this.vectorStore.searchChunks(query, limit, filter);
  }

  /**
   * Gets the underlying VectorStoreAdapter for memory integration.
   */
  getVectorStore(): VectorStoreAdapter {
    return this.vectorStore;
  }
}
