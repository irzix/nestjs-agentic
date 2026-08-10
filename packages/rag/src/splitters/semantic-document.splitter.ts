import { randomUUID } from 'crypto';
import type { Document, DocumentChunk, DocumentSplitter } from '../interfaces/document.interface';

/**
 * Options for configuring SemanticDocumentSplitter.
 */
export interface SemanticDocumentSplitterOptions {
  /** Maximum character length per section chunk before splitting further. Default: `500` */
  maxChunkSize?: number;

  /** Minimum character length for a section chunk. Default: `50` */
  minChunkSize?: number;

  /** Character overlap between consecutive sub-chunks. Default: `50` */
  chunkOverlap?: number;
}

/**
 * Splits domain documents based on semantic section headers (#, ##), paragraphs, and sentence boundaries
 * while extracting section headers into metadata and preserving chunk overlap.
 */
export class SemanticDocumentSplitter implements DocumentSplitter {
  private readonly maxChunkSize: number;
  private readonly minChunkSize: number;
  private readonly chunkOverlap: number;

  /**
   * Creates a new instance of SemanticDocumentSplitter.
   * @param options Configuration options for max chunk size, min chunk size, and chunk overlap.
   */
  constructor(options?: SemanticDocumentSplitterOptions) {
    this.maxChunkSize = options?.maxChunkSize ?? 500;
    this.minChunkSize = options?.minChunkSize ?? 50;
    this.chunkOverlap = options?.chunkOverlap ?? 50;
  }

  /**
   * Splits a Document into semantic section chunks based on Markdown headers and paragraph boundaries.
   *
   * @param document The target Document object to split.
   * @returns Promise resolving to an array of generated DocumentChunk objects.
   */
  async splitDocument(document: Document): Promise<DocumentChunk[]> {
    const raw = document.rawContent || '';
    if (!raw.trim()) {
      return [];
    }

    const rawSections = raw.split(/(?=\n#{1,6}\s+)|\n\n+/);
    const chunks: DocumentChunk[] = [];
    let currentSectionTitle = document.title;

    for (let i = 0; i < rawSections.length; i++) {
      const section = rawSections[i].trim();
      if (!section) continue;

      const headerMatch = section.match(/^#{1,6}\s+(.+)$/m);
      if (headerMatch) {
        currentSectionTitle = headerMatch[1].trim();
      }

      if (section.length <= this.maxChunkSize) {
        chunks.push({
          id: `${document.id}_chunk_${chunks.length}_${randomUUID().slice(0, 8)}`,
          parentId: document.id,
          content: section,
          metadata: {
            ...document.metadata,
            chunkIndex: chunks.length,
            documentTitle: document.title,
            sectionTitle: currentSectionTitle,
          },
        });
      } else {
        const sentences = section.split(/(?<=[.!?\n])\s+/);
        let currentChunk = '';

        for (const sentence of sentences) {
          if ((currentChunk + ' ' + sentence).length > this.maxChunkSize && currentChunk.length >= this.minChunkSize) {
            chunks.push({
              id: `${document.id}_chunk_${chunks.length}_${randomUUID().slice(0, 8)}`,
              parentId: document.id,
              content: currentChunk.trim(),
              metadata: {
                ...document.metadata,
                chunkIndex: chunks.length,
                documentTitle: document.title,
                sectionTitle: currentSectionTitle,
              },
            });

            const overlapStart = Math.max(0, currentChunk.length - this.chunkOverlap);
            currentChunk = currentChunk.slice(overlapStart) + ' ' + sentence;
          } else {
            currentChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence;
          }
        }

        if (currentChunk.trim()) {
          chunks.push({
            id: `${document.id}_chunk_${chunks.length}_${randomUUID().slice(0, 8)}`,
            parentId: document.id,
            content: currentChunk.trim(),
            metadata: {
              ...document.metadata,
              chunkIndex: chunks.length,
              documentTitle: document.title,
              sectionTitle: currentSectionTitle,
            },
          });
        }
      }
    }

    return chunks;
  }
}
