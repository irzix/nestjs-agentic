import { randomUUID } from 'crypto';
import type { Document, DocumentChunk, DocumentSplitter } from '../interfaces/document.interface';

export interface SemanticDocumentSplitterOptions {
  maxChunkSize?: number;
  minChunkSize?: number;
  chunkOverlap?: number;
}

/**
 * Splits domain documents based on semantic section headers, paragraphs, and sentence boundaries
 * while extracting section headers into metadata and preserving chunk overlap.
 */
export class SemanticDocumentSplitter implements DocumentSplitter {
  private readonly maxChunkSize: number;
  private readonly minChunkSize: number;
  private readonly chunkOverlap: number;

  constructor(options?: SemanticDocumentSplitterOptions) {
    this.maxChunkSize = options?.maxChunkSize ?? 500;
    this.minChunkSize = options?.minChunkSize ?? 50;
    this.chunkOverlap = options?.chunkOverlap ?? 50;
  }

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

      // Extract markdown header if present (# Section Header)
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
        // Sub-split large section into sentences/paragraphs
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

            // Carry over overlap text
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
